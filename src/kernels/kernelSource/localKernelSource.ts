// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { Event, CancellationToken, EventEmitter } from 'vscode';
import { Resource } from '../../platform/common/types';
import { IKernelSource, KernelConnectionMetadata, KernelSourceType } from '../types';

export class LocalKernelSource implements IKernelSource {
    private _onDidChangeKernels = new EventEmitter<void>();

    constructor() {
        this.id = 'LOCALKERNELSOURCE';
        this.displayName = 'Local'; // IANHU: Localize
        this.type = 'local';
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
