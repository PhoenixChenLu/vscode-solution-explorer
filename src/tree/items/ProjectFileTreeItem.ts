import { ProjectItemEntry } from "@core/Projects";
import { TreeItem, TreeItemCollapsibleState, TreeItemContext, ContextValues } from "@tree";

export class ProjectFileTreeItem extends TreeItem {
    constructor(context: TreeItemContext, private readonly projectFile: ProjectItemEntry, private readonly relatedFiles: ProjectItemEntry[] = []) {
        super(context, projectFile.name, relatedFiles.length > 0 ? TreeItemCollapsibleState.Collapsed : TreeItemCollapsibleState.None, ContextValues.projectFile, projectFile.fullPath);
        if (projectFile.isLink) {
            this.description = "link";
        }
        if (projectFile.dependentUpon) {
            this.description = "dependent";
        }

        this.addContextValueSuffix();
    }

    command = {
		command: 'solutionExplorer.openFile',
		arguments: [this],
		title: 'Open File'
	};

    protected createChildren(childContext: TreeItemContext): Promise<TreeItem[]> {
        const result: TreeItem[] = [];
        if(this.relatedFiles.length > 0) {
            this.relatedFiles.forEach(f => {
                const item = new ProjectFileTreeItem(this.context, f);
                item.description = "dependent";
                result.push(item);
            });
        }

        return Promise.resolve(result);
	}

    protected addContextValueSuffix(): void {
        if (this.project?.extension.toLocaleLowerCase() === 'fsproj') {
		    this.contextValue += '-fs';
        }
	}
}
