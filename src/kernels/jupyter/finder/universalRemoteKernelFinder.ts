// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { CancellationToken, CancellationTokenSource, Event, EventEmitter, Memento, Uri } from 'vscode';
import { getKernelId, getLanguageInKernelSpec, serializeKernelConnection } from '../../helpers';
import {
    IJupyterKernelSpec,
    IKernelProvider,
    INotebookProvider,
    INotebookProviderConnection,
    isRemoteConnection,
    LiveRemoteKernelConnectionMetadata,
    RemoteKernelConnectionMetadata,
    RemoteKernelSpecConnectionMetadata
} from '../../types';
import { IDisposable, IExtensions } from '../../../platform/common/types';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { capturePerfTelemetry, Telemetry } from '../../../telemetry';
import {
    IJupyterSessionManagerFactory,
    IJupyterSessionManager,
    IJupyterRemoteCachedKernelValidator,
    IRemoteKernelFinder,
    IJupyterServerUriEntry
} from '../types';
import { sendKernelSpecTelemetry } from '../../raw/finder/helper';
import { traceError, traceWarning, traceInfoIfCI, traceVerbose } from '../../../platform/logging';
import { IPythonExtensionChecker } from '../../../platform/api/types';
import { computeServerId } from '../jupyterUtils';
import { PYTHON_LANGUAGE } from '../../../platform/common/constants';
import { createPromiseFromCancellation } from '../../../platform/common/cancellation';
import { DisplayOptions } from '../../displayOptions';
import * as localize from '../../../platform/common/utils/localize';
import { isArray } from '../../../platform/common/utils/sysTypes';
import { deserializeKernelConnection } from '../../helpers';
import { noop } from '../../../platform/common/utils/misc';
import { IApplicationEnvironment } from '../../../platform/common/application/types';
import { KernelFinder } from '../../kernelFinder';
import { RemoteKernelSpecsCacheKey, removeOldCachedItems } from '../../common/commonFinder';
import { ContributedKernelFinderKind, IContributedKernelFinderInfo } from '../../internalTypes';
import { disposeAllDisposables } from '../../../platform/common/helpers';

// Even after shutting down a kernel, the server API still returns the old information.
// Re-query after 2 seconds to ensure we don't get stale information.
const REMOTE_KERNEL_REFRESH_INTERVAL = 2_000;

// This class watches a single jupyter server URI and returns kernels from it
export class UniversalRemoteKernelFinder implements IRemoteKernelFinder, IContributedKernelFinderInfo, IDisposable {
    /**
     * List of ids of kernels that should be hidden from the kernel picker.
     */
    private readonly kernelIdsToHide = new Set<string>();
    kind = ContributedKernelFinderKind.Remote;
    id: string;
    displayName: string;
    private _cacheUpdateCancelTokenSource: CancellationTokenSource | undefined;
    private cache: RemoteKernelConnectionMetadata[] = [];

    private _onDidChangeKernels = new EventEmitter<void>();
    onDidChangeKernels: Event<void> = this._onDidChangeKernels.event;

    private readonly disposables: IDisposable[] = [];

    // Track our delay timer for when we update on kernel dispose
    private kernelDisposeDelayTimer: NodeJS.Timeout | number | undefined;

    private wasPythonInstalledWhenFetchingKernels = false;

    constructor(
        private jupyterSessionManagerFactory: IJupyterSessionManagerFactory,
        private interpreterService: IInterpreterService,
        private extensionChecker: IPythonExtensionChecker,
        private readonly notebookProvider: INotebookProvider,
        private readonly globalState: Memento,
        private readonly env: IApplicationEnvironment,
        private readonly cachedRemoteKernelValidator: IJupyterRemoteCachedKernelValidator,
        kernelFinder: KernelFinder,
        private readonly kernelProvider: IKernelProvider,
        private readonly extensions: IExtensions,
        private isWebExtension: boolean,
        private readonly serverUri: IJupyterServerUriEntry
    ) {
        // Register with remote-serverId as our ID
        this.id = `${this.kind}-${serverUri.serverId}`;

        // Create a reasonable display name for this kernel finder
        this.displayName = localize.DataScience.universalRemoteKernelFinderDisplayName().format(
            serverUri.displayName || serverUri.uri
        );

        // When we register, add a disposable to clean ourselves up from the main kernel finder list
        // Unlike the Local kernel finder universal remote kernel finders will be added on the fly
        this.disposables.push(kernelFinder.registerKernelFinder(this));

        this.disposables.push(this._onDidChangeKernels);
    }

    dispose(): void | undefined {
        if (this.kernelDisposeDelayTimer) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            clearTimeout(this.kernelDisposeDelayTimer as any);
        }
        disposeAllDisposables(this.disposables);
    }

    async activate(): Promise<void> {
        // warm up the cache
        this.loadCache().then(noop, noop);

        // If we create a new kernel, we need to refresh if the kernel is remote (because
        // we have live sessions possible)
        // Note, this is a perf optimization for right now. We should not need
        // to check for remote if the future when we support live sessions on local
        this.kernelProvider.onDidStartKernel(
            (k) => {
                if (isRemoteConnection(k.kernelConnectionMetadata)) {
                    // update remote kernels
                    this.updateCache().then(noop, noop);
                }
            },
            this,
            this.disposables
        );

        // For kernel dispose we need to wait a bit, otherwise the list comes back the
        // same
        this.kernelProvider.onDidDisposeKernel(
            (k) => {
                if (k && isRemoteConnection(k.kernelConnectionMetadata)) {
                    if (this.kernelDisposeDelayTimer) {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        clearTimeout(this.kernelDisposeDelayTimer as any);
                        this.kernelDisposeDelayTimer = undefined;
                    }
                    const timer = setTimeout(() => {
                        this.updateCache().then(noop, noop);
                    }, REMOTE_KERNEL_REFRESH_INTERVAL);

                    this.kernelDisposeDelayTimer = timer;

                    return timer;
                }
            },
            this,
            this.disposables
        );

        this.extensions.onDidChange(
            () => {
                // If we just installed the Python extension and we fetched the controllers, then fetch it again.
                if (!this.wasPythonInstalledWhenFetchingKernels && this.extensionChecker.isPythonExtensionInstalled) {
                    this.updateCache().then(noop, noop);
                }
            },
            this,
            this.disposables
        );
        this.wasPythonInstalledWhenFetchingKernels = this.extensionChecker.isPythonExtensionInstalled;
    }

    private async loadCache() {
        traceInfoIfCI(`Remote Kernel Finder load cache Server: ${this.id}`);

        const kernelsFromCache = await this.getFromCache();

        let kernels: RemoteKernelConnectionMetadata[] = [];

        // If we finish the cache first, and we don't have any items, in the cache, then load without cache.
        if (Array.isArray(kernelsFromCache) && kernelsFromCache.length > 0) {
            kernels = kernelsFromCache;
            // kick off a cache update request
            this.updateCache().then(noop, noop);
        } else {
            try {
                const kernelsWithoutCachePromise = (async () => {
                    const connInfo = await this.getRemoteConnectionInfo();
                    return connInfo ? this.listKernelsFromConnection(connInfo) : Promise.resolve([]);
                })();

                kernels = await kernelsWithoutCachePromise;
            } catch (ex) {
                traceError('UniversalRemoteKernelFinder: Failed to get kernels without cache', ex);
            }
        }

        await this.writeToCache(kernels);
    }

    private async updateCache() {
        let kernels: RemoteKernelConnectionMetadata[] = [];
        this._cacheUpdateCancelTokenSource?.dispose();
        const updateCacheCancellationToken = new CancellationTokenSource();
        this._cacheUpdateCancelTokenSource = updateCacheCancellationToken;

        try {
            const kernelsWithoutCachePromise = (async () => {
                const connInfo = await this.getRemoteConnectionInfo(updateCacheCancellationToken.token);
                return connInfo ? this.listKernelsFromConnection(connInfo) : Promise.resolve([]);
            })();

            kernels = await kernelsWithoutCachePromise;
        } catch (ex) {
            traceWarning(`Could not fetch kernels from the ${this.kind} server, falling back to cache: ${ex}`);
            // Since fetching the remote kernels failed, we fall back to the cache,
            // at this point no need to display all of the kernel specs,
            // Its possible the connection is dead, just display the live kernels we had.
            // I.e. if user had a notebook connected to a remote kernel, then just display that live kernel.
            kernels = await this.getFromCache(updateCacheCancellationToken.token);
            kernels = kernels.filter((item) => item.kind === 'connectToLiveRemoteKernel');
        }

        if (updateCacheCancellationToken.token.isCancellationRequested) {
            return;
        }

        await this.writeToCache(kernels);
    }

    /**
     *
     * Remote kernel finder is resource agnostic.
     */
    public get kernels(): RemoteKernelConnectionMetadata[] {
        return this.cache;
    }

    private async getRemoteConnectionInfo(
        cancelToken?: CancellationToken
    ): Promise<INotebookProviderConnection | undefined> {
        const ui = new DisplayOptions(false);
        return this.notebookProvider.connect({
            resource: undefined,
            ui,
            localJupyter: false,
            token: cancelToken,
            serverId: this.serverUri.serverId
        });
    }

    private async getFromCache(cancelToken?: CancellationToken): Promise<RemoteKernelConnectionMetadata[]> {
        try {
            traceVerbose('UniversalRemoteKernelFinder: get from cache');

            let results: RemoteKernelConnectionMetadata[] = this.cache;
            const key = this.getCacheKey();

            // If not in memory, check memento
            if (!results || results.length === 0) {
                // Check memento too
                const values = this.globalState.get<{
                    kernels: RemoteKernelConnectionMetadata[];
                    extensionVersion: string;
                }>(key, { kernels: [], extensionVersion: '' });

                if (values && isArray(values.kernels) && values.extensionVersion === this.env.extensionVersion) {
                    results = values.kernels.map(deserializeKernelConnection) as RemoteKernelConnectionMetadata[];
                    this.cache = results;
                }
            }

            // Validate
            const validValues: RemoteKernelConnectionMetadata[] = [];
            const promise = Promise.all(
                results.map(async (item) => {
                    if (await this.isValidCachedKernel(item)) {
                        validValues.push(item);
                    }
                })
            );
            if (cancelToken) {
                await Promise.race([
                    promise,
                    createPromiseFromCancellation({
                        token: cancelToken,
                        cancelAction: 'resolve',
                        defaultValue: undefined
                    })
                ]);
            } else {
                await promise;
            }
            return validValues;
        } catch (ex) {
            traceError('UniversalRemoteKernelFinder: Failed to get from cache', ex);
        }

        return [];
    }

    // Talk to the remote server to determine sessions
    @capturePerfTelemetry(Telemetry.KernelListingPerf, { kind: 'remote' })
    public async listKernelsFromConnection(
        connInfo: INotebookProviderConnection
    ): Promise<RemoteKernelConnectionMetadata[]> {
        // Get a jupyter session manager to talk to
        let sessionManager: IJupyterSessionManager | undefined;
        // This should only be used when doing remote.
        if (connInfo.type === 'jupyter') {
            try {
                sessionManager = await this.jupyterSessionManagerFactory.create(connInfo);

                // Get running and specs at the same time
                const [running, specs, sessions, serverId] = await Promise.all([
                    sessionManager.getRunningKernels(),
                    sessionManager.getKernelSpecs(),
                    sessionManager.getRunningSessions(),
                    computeServerId(connInfo.url)
                ]);

                // Turn them both into a combined list
                const mappedSpecs = await Promise.all(
                    specs.map(async (s) => {
                        await sendKernelSpecTelemetry(s, 'remote');
                        const kernel: RemoteKernelSpecConnectionMetadata = {
                            kind: 'startUsingRemoteKernelSpec',
                            interpreter: await this.getInterpreter(s, connInfo.baseUrl),
                            kernelSpec: s,
                            id: getKernelId(s, undefined, serverId),
                            baseUrl: connInfo.baseUrl,
                            serverId: serverId
                        };
                        return kernel;
                    })
                );
                const mappedLive = sessions.map((s) => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const liveKernel = s.kernel as any;
                    const lastActivityTime = liveKernel.last_activity
                        ? new Date(Date.parse(liveKernel.last_activity.toString()))
                        : new Date();
                    const numberOfConnections = liveKernel.connections
                        ? parseInt(liveKernel.connections.toString(), 10)
                        : 0;
                    const activeKernel = running.find((active) => active.id === s.kernel?.id) || {};
                    const matchingSpec: Partial<IJupyterKernelSpec> =
                        specs.find((spec) => spec.name === s.kernel?.name) || {};

                    const kernel: LiveRemoteKernelConnectionMetadata = {
                        kind: 'connectToLiveRemoteKernel',
                        kernelModel: {
                            ...s.kernel,
                            ...matchingSpec,
                            ...activeKernel,
                            name: s.kernel?.name || '',
                            lastActivityTime,
                            numberOfConnections,
                            model: s
                        },
                        baseUrl: connInfo.baseUrl,
                        id: s.kernel?.id || '',
                        serverId
                    };
                    return kernel;
                });

                // Filter out excluded ids
                const filtered = mappedLive.filter((k) => !this.kernelIdsToHide.has(k.kernelModel.id || ''));
                const items = [...filtered, ...mappedSpecs];
                return items;
            } catch (ex) {
                traceError(`Error fetching remote kernels:`, ex);
                throw ex;
            } finally {
                if (sessionManager) {
                    await sessionManager.dispose();
                }
            }
        }
        return [];
    }

    private async getInterpreter(spec: IJupyterKernelSpec, baseUrl: string) {
        const parsed = new URL(baseUrl);
        if (
            (parsed.hostname.toLocaleLowerCase() === 'localhost' || parsed.hostname === '127.0.0.1') &&
            this.extensionChecker.isPythonExtensionInstalled &&
            !this.isWebExtension &&
            getLanguageInKernelSpec(spec) === PYTHON_LANGUAGE
        ) {
            // Interpreter is possible. Same machine as VS code
            try {
                traceInfoIfCI(`Getting interpreter details for localhost remote kernel: ${spec.name}`);
                return await this.interpreterService.getInterpreterDetails(Uri.file(spec.argv[0]));
            } catch (ex) {
                traceError(`Failure getting interpreter details for remote kernel: `, ex);
            }
        }
    }

    private getCacheKey() {
        // For Universal finders key each one per serverId
        return `${RemoteKernelSpecsCacheKey}-${this.serverUri.serverId}`;
    }

    private async writeToCache(values: RemoteKernelConnectionMetadata[]) {
        try {
            traceVerbose(
                `UniversalRemoteKernelFinder: Writing ${values.length} remote kernel connection metadata to cache`
            );

            const key = this.getCacheKey();
            this.cache = values;
            const serialized = values.map(serializeKernelConnection);
            await Promise.all([
                removeOldCachedItems(this.globalState),
                this.globalState.update(key, { kernels: serialized, extensionVersion: this.env.extensionVersion })
            ]);

            this._onDidChangeKernels.fire();
        } catch (ex) {
            traceError('UniversalRemoteKernelFinder: Failed to write to cache', ex);
        }
    }

    private async isValidCachedKernel(kernel: RemoteKernelConnectionMetadata): Promise<boolean> {
        switch (kernel.kind) {
            case 'startUsingRemoteKernelSpec':
                // Always fetch the latest kernels from remotes, no need to display cached remote kernels.
                return false;
            case 'connectToLiveRemoteKernel':
                return this.cachedRemoteKernelValidator.isValid(kernel);
        }
    }
}
