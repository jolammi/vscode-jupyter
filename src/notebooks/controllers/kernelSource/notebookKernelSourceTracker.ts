// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { NotebookDocument, workspace } from 'vscode';
import { IContributedKernelFinderInfo } from '../../../kernels/internalTypes';
import { IKernelFinder } from '../../../kernels/types';
import { IDisposableRegistry } from '../../../platform/common/types';
import { INotebookKernelSourceTracker } from '../types';

// Tracks what kernel source is assigned to which document, also will persist that data
@injectable()
export class NotebookKernelSourceTracker implements INotebookKernelSourceTracker {
    private documentSourceMapping: WeakMap<NotebookDocument, IContributedKernelFinderInfo> = new WeakMap<
        NotebookDocument,
        IContributedKernelFinderInfo
    >();

    constructor(
        @inject(IDisposableRegistry) private readonly disposableRegistry: IDisposableRegistry,
        @inject(IKernelFinder) private readonly kernelFinder: IKernelFinder
    ) {
        workspace.onDidOpenNotebookDocument(this.onDidOpenNotebookDocument, this, this.disposableRegistry);
    }

    public getKernelSourceForNotebook(notebook: NotebookDocument): IContributedKernelFinderInfo | undefined {
        return this.documentSourceMapping.get(notebook);
    }
    public setKernelSourceForNotebook(notebook: NotebookDocument, kernelSource: IContributedKernelFinderInfo): void {
        this.documentSourceMapping.set(notebook, kernelSource);
    }

    private onDidOpenNotebookDocument(_notebook: NotebookDocument) {
        // IANHU: Default thing to use here? For now, just use the first thing
        // IANHU: We need to add the persist in here next
        // IANHU: actually to start out, just leave undefined, we can show either everything or nothing in these cases
        // const kernelFinderInfos = this.kernelFinder.getRegisteredKernelFinderInfo();
        // if (kernelFinderInfos.length > 0) {
        // this.documentSourceMapping.set(notebook, kernelFinderInfos[0]);
        // }
    }
}
