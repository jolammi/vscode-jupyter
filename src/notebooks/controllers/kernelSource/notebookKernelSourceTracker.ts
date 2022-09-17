// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { NotebookDocument, workspace } from 'vscode';
import { IKernelSource, IKernelSourceService } from '../../../kernels/types';
import { IDisposableRegistry } from '../../../platform/common/types';
import { INotebookKernelSourceTracker } from '../types';

// Tracks what kernel source is assigned to which document, also will persist that data
@injectable()
export class NotebookKernelSourceTracker implements INotebookKernelSourceTracker {
    private documentSourceMapping: WeakMap<NotebookDocument, IKernelSource> = new WeakMap<
        NotebookDocument,
        IKernelSource
    >();

    constructor(
        @inject(IDisposableRegistry) private readonly disposableRegistry: IDisposableRegistry,
        @inject(IKernelSourceService) private readonly kernelSourceService: IKernelSourceService
    ) {
        workspace.onDidOpenNotebookDocument(this.onDidOpenNotebookDocument, this, this.disposableRegistry);
    }

    public getKernelSourceForNotebook(notebook: NotebookDocument): IKernelSource | undefined {
        return this.documentSourceMapping.get(notebook);
    }
    public setKernelSourceForNotebook(notebook: NotebookDocument, kernelSource: IKernelSource): void {
        this.documentSourceMapping.set(notebook, kernelSource);
    }

    private onDidOpenNotebookDocument(notebook: NotebookDocument) {
        // IANHU: Default thing to use here? For now, just use the first thing
        const kernelSources = this.kernelSourceService.getKernelSources();
        if (kernelSources.length > 0) {
            this.documentSourceMapping.set(notebook, kernelSources[0]);
        }
    }
}
