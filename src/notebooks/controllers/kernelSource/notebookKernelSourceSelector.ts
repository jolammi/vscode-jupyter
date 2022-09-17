// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { NotebookDocument, QuickPickItem } from 'vscode';
import { IKernelSource, IKernelSourceService } from '../../../kernels/types';
import { IApplicationShell } from '../../../platform/common/application/types';
import { INotebookKernelSourceSelector, INotebookKernelSourceTracker } from '../types';

interface KernelSourceQuickPickItem extends QuickPickItem {
    kernelSource: IKernelSource;
}

@injectable()
export class NotebookKernelSourceSelector implements INotebookKernelSourceSelector {
    constructor(
        @inject(IKernelSourceService) private readonly kernelSourceService: IKernelSourceService,
        @inject(IApplicationShell) private readonly applicationShell: IApplicationShell,
        @inject(INotebookKernelSourceTracker) private readonly kernelSourceTracker: INotebookKernelSourceTracker
    ) {}

    public async selectKernelSource(notebook: NotebookDocument): Promise<void> {
        const quickPickItems = this.kernelSourceService.getKernelSources().map(this.toQuickPickItem);

        const selectedItem = await this.applicationShell.showQuickPick(quickPickItems);

        // If we selected something persist that value
        if (selectedItem) {
            this.kernelSourceTracker.setKernelSourceForNotebook(notebook, selectedItem.kernelSource);
        }
    }

    toQuickPickItem(kernelSource: IKernelSource): KernelSourceQuickPickItem {
        return { kernelSource, label: kernelSource.displayName };
    }
}
