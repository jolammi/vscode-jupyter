// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { Event, CancellationToken, EventEmitter } from 'vscode';
import { IDisposableRegistry, Resource } from '../../platform/common/types';
import { ILocalKernelFinder } from '../raw/types';
import { IKernelSource, KernelConnectionMetadata, KernelSourceType } from '../types';

export class LocalKernelSource implements IKernelSource {
    private _onDidChangeKernels = new EventEmitter<void>();

    constructor(
        private readonly localKernelFinder: ILocalKernelFinder,
        private readonly disposables: IDisposableRegistry
    ) {
        this.id = 'LOCALKERNELSOURCE';
        this.displayName = 'Local'; // IANHU: Localize
        this.type = 'local';

        this.disposables.push(localKernelFinder.onDidChangeKernels(() => this._onDidChangeKernels.fire()));
    }

    //#region IKernelSource implementation

    public id: string;
    public displayName: string;
    public type: KernelSourceType;
    public get onDidChangeKernels(): Event<void> {
        return this._onDidChangeKernels.event;
    }

    listKernels(resource: Resource, cancelToken?: CancellationToken | undefined): Promise<KernelConnectionMetadata[]> {
        return this.localKernelFinder.listKernels(resource, cancelToken);
    }

    //#endregion
}
