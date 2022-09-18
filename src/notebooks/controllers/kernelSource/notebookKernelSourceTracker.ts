// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { NotebookControllerAffinity, NotebookDocument, workspace } from 'vscode';
import { IContributedKernelFinderInfo } from '../../../kernels/internalTypes';
import { IDisposableRegistry } from '../../../platform/common/types';
import { IControllerRegistration, INotebookKernelSourceTracker, IVSCodeNotebookController } from '../types';

// Tracks what kernel source is assigned to which document, also will persist that data
@injectable()
export class NotebookKernelSourceTracker implements INotebookKernelSourceTracker {
    private documentSourceMapping: WeakMap<NotebookDocument, IContributedKernelFinderInfo> = new WeakMap<
        NotebookDocument,
        IContributedKernelFinderInfo
    >();

    constructor(
        @inject(IDisposableRegistry) private readonly disposableRegistry: IDisposableRegistry,
        @inject(IControllerRegistration) private readonly controllerRegistration: IControllerRegistration
    ) {
        workspace.onDidOpenNotebookDocument(this.onDidOpenNotebookDocument, this, this.disposableRegistry);
    }

    public getKernelSourceForNotebook(notebook: NotebookDocument): IContributedKernelFinderInfo | undefined {
        return this.documentSourceMapping.get(notebook);
    }
    public setKernelSourceForNotebook(notebook: NotebookDocument, kernelSource: IContributedKernelFinderInfo): void {
        this.documentSourceMapping.set(notebook, kernelSource);

        // After setting the kernelsource we now need to change the affinity of the controllers to hide all controllers not from that finder
        this.updateControllerAffinity(notebook, kernelSource);
    }

    private updateControllerAffinity(notebook: NotebookDocument, kernelSource: IContributedKernelFinderInfo) {
        const nonAssociatedControllers = this.controllerRegistration.registered.filter((controller) => {
            if (
                !controller.connection.kernelFinderInfo ||
                controller.connection.kernelFinderInfo.id !== kernelSource.id
            ) {
                // If the controller doesn't have kernel finder info or if it doesn't match, return it
                return true;
            }
            return false;
        });

        nonAssociatedControllers.forEach((controller) => {
            this.disassociateController(notebook, controller);
        });
    }

    private disassociateController(notebook: NotebookDocument, controller: IVSCodeNotebookController) {
        // IANHU: Hook up with affinity hidden here
        controller.controller.updateNotebookAffinity(notebook, NotebookControllerAffinity.Default);
        //controller.controller.updateNotebookAffinity(notebook, NotebookControllerAffinity.Hidden);
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
