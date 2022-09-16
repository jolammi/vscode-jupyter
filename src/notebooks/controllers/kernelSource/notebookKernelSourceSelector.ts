// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { injectable } from 'inversify';
import { NotebookDocument } from 'vscode';
import { INotebookKernelSourceSelector } from '../types';

@injectable()
export class NotebookKernelSourceSelector implements INotebookKernelSourceSelector {
    selectKernelSource(_notebook: NotebookDocument): Promise<void> {
        throw new Error('Method not implemented.');
    }
}
