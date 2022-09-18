// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { inject, injectable, optional } from 'inversify';
import { Event, EventEmitter } from 'vscode';
import { IDisposableRegistry, IsWebExtension } from '../../platform/common/types';
import { ILocalKernelFinder } from '../raw/types';
import { IKernelSource, IKernelSourceService } from '../types';
import { LocalKernelSource } from './localKernelSource';
import { RemoteKernelSource } from './remoteKernelSource';

@injectable()
export class KernelSourceService implements IKernelSourceService {
    private kernelSources: IKernelSource[] = [];

    private _onDidChangeKernelSources = new EventEmitter<void>();

    constructor(
        @inject(IsWebExtension) private readonly isWebExtension: boolean,
        @inject(ILocalKernelFinder) @optional() localKernelFinder: ILocalKernelFinder | undefined,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry
    ) {
        // Local Kernel Source is not available on the web extenstion
        if (!this.isWebExtension && localKernelFinder) {
            this.kernelSources.push(new LocalKernelSource(localKernelFinder, disposables));
        }
        this.kernelSources.push(new RemoteKernelSource());
    }

    public get onDidChangeKernelSources(): Event<void> {
        return this._onDidChangeKernelSources.event;
    }
    public getKernelSources(): IKernelSource[] {
        return this.kernelSources;
    }
}
