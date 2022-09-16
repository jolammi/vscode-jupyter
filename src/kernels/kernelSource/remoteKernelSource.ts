// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { Event, CancellationToken, EventEmitter } from 'vscode';
import { Resource } from '../../platform/common/types';
import { IKernelSource, KernelConnectionMetadata, KernelSourceType } from '../types';

export class RemoteKernelSource implements IKernelSource {
    private _onDidChangeKernels = new EventEmitter<void>();

    constructor() {
        this.id = 'REMOTEKERNELSOURCE';
        this.displayName = 'Remote'; // IANHU: Localize
        this.type = 'remote';
    }

    //#region IKernelSource implementation

    public id: string;
    public displayName: string;
    public type: KernelSourceType;
    public get onDidChangeKernels(): Event<void> {
        return this._onDidChangeKernels.event;
    }
    listKernels(
        _resource: Resource,
        _cancelToken?: CancellationToken | undefined
    ): Promise<KernelConnectionMetadata[]> {
        return Promise.resolve([]);
    }

    //#endregion
}
