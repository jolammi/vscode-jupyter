// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { injectable } from 'inversify';
import { Event, EventEmitter } from 'vscode';
import { IKernelSource, IKernelSourceService } from '../types';
import { LocalKernelSource } from './localKernelSource';
import { RemoteKernelSource } from './remoteKernelSource';

@injectable()
export class KernelSourceService implements IKernelSourceService {
    private kernelSources: IKernelSource[] = [];

    private _onDidChangeKernelSources = new EventEmitter<void>();

    constructor() {
        this.kernelSources.push(new LocalKernelSource());
        this.kernelSources.push(new RemoteKernelSource());
    }

    public get onDidChangeKernelSources(): Event<void> {
        return this._onDidChangeKernelSources.event;
    }
    public getKernelSources(): IKernelSource[] {
        return this.kernelSources;
    }
}
