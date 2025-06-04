import * as path from "@extensions/path";
import { getItemNesting } from "@extensions/config";
import { Solution, SolutionProject, SolutionFolder, SolutionItem } from "@core/Solutions";
import { PackageReference, Project, ProjectFactory, ProjectItemEntry } from "@core/Projects";
import { SolutionExplorerProvider } from "@SolutionExplorerProvider";
import { TreeItem } from "@tree/TreeItem";
import { TreeItemContext } from "@tree/TreeItemContext";
import { SolutionFolderTreeItem } from "@tree/items/SolutionFolderTreeItem";
import { UnknownProjectTreeItem } from "@tree/items/UnknownProjectTreeItem";
import { ProjectTreeItem } from "@tree/items/ProjectTreeItem";
import { SolutionTreeItem } from "@tree/items/SolutionTreeItem";
import { ProjectFolderTreeItem } from "@tree/items/ProjectFolderTreeItem";
import { ProjectFileTreeItem } from "@tree/items/ProjectFileTreeItem";
import { CpsProjectTreeItem } from "@tree/items/cps/CpsProjectTreeItem";
import { StandardProjectTreeItem } from "@tree/items/standard/StandardProjectTreeItem";
import { SolutionFileTreeItem } from "@tree/items/SolutionFileTreeItem";
import { ProjectReferencedPackageTreeItem } from "./items/ProjectReferencedPackageTreeItem";

export async function createFromSolution(provider: SolutionExplorerProvider, solution: Solution, workspaceRoot: string): Promise<TreeItem> {
    let context = new TreeItemContext(provider, solution, workspaceRoot);
    let treeItem = new SolutionTreeItem(context);
    await treeItem.getChildren();
    await treeItem.refreshContextValue();
    return treeItem;
}

export async function createItemsFromSolution(context: TreeItemContext, solution: Solution, solutionItem?: SolutionItem): Promise<TreeItem[]> {
    let result: TreeItem[] = [];
    let folders: SolutionFolder[] = solution.getFolders();
    let projects: SolutionProject[] = solution.getProjects();
    if (solutionItem instanceof SolutionFolder) {
        folders = solutionItem.getFolders();
        projects = solutionItem.getProjects();
    }

    folders.sort((a, b) => {
        let x = a.name.toLowerCase();
        let y = b.name.toLowerCase();
        return x < y ? -1 : x > y ? 1 : 0;
    });

    projects.sort((a, b) => {
        let x = a.name.toLowerCase();
        let y = b.name.toLowerCase();
        return x < y ? -1 : x > y ? 1 : 0;
    });

    for(let i = 0; i < folders.length; i++) {
        result.push(await createFromProject(context, folders[i]));
    }

    for(let i = 0; i < projects.length; i++) {
        result.push(await createFromProject(context, projects[i]));
    }

    if (solutionItem instanceof SolutionFolder) {
        Object.keys(solutionItem.solutionFiles).forEach(k => {
            const fullpath = path.join(solution.folderPath, solutionItem.solutionFiles[k]);
            result.push(new SolutionFileTreeItem(context, k, fullpath, solutionItem));
        });
    }

    return result;
}

async function createFromProject(context: TreeItemContext, project: SolutionItem): Promise<TreeItem> {
    if (project instanceof SolutionFolder) {
        const treeItem = await SolutionFolderTreeItem.create(context, project);
        await treeItem.getChildren();
        return treeItem;
    }

    const p = await ProjectFactory.parse(project);
    const projectContext = context.copy(p);
    if (p) {
        if (p.type === 'cps') { return new CpsProjectTreeItem(projectContext, project); }
        if (p.type === 'standard') { return new StandardProjectTreeItem(projectContext, project); }
        return new ProjectTreeItem(projectContext, project);
    }

    return new UnknownProjectTreeItem(projectContext, project);
}

export async function createItemsFromProject(context: TreeItemContext, project: Project, virtualPath?: string): Promise<TreeItem[]> {
    if (!virtualPath) { virtualPath = "."; }

    const result: TreeItem[] = [];
    const items = await project.getProjectItemEntries();
    const isFolder = (item:ProjectItemEntry) => item.isDirectory && path.dirname(item.relativePath) === virtualPath;
    const isFile = (item:ProjectItemEntry) => !item.isDirectory && path.dirname(item.relativePath) === virtualPath;
    const folders = items.filter(isFolder);
    const files = items.filter(isFile);

    // 首先处理文件夹
    folders.sort((a, b) => {
        const x = a.name.toLowerCase();
        const y = b.name.toLowerCase();
        return x < y ? -1 : x > y ? 1 : 0;
    });

    folders.forEach(folder => {
        result.push(new ProjectFolderTreeItem(context, folder));
    });

    // 处理文件，考虑 DependentUpon 关系
    const processedFiles = new Set<string>();
    const fileMap = new Map<string, ProjectItemEntry>();
    
    // 首先创建文件映射
    files.forEach(file => {
        fileMap.set(file.fullPath, file);
    });

    // 处理主文件和依赖文件
    files.forEach(file => {
        if (processedFiles.has(file.fullPath)) return;

        const related: ProjectItemEntry[] = [];
        let currentFile = file;

        // 收集所有相关文件
        while (currentFile.dependentUpon) {
            const dependentPath = path.join(path.dirname(currentFile.fullPath), currentFile.dependentUpon);
            const dependentFile = fileMap.get(dependentPath);
            if (dependentFile) {
                related.push(dependentFile);
                processedFiles.add(dependentFile.fullPath);
                currentFile = dependentFile;
            } else {
                break;
            }
        }

        // 添加主文件及其相关文件
        if (!processedFiles.has(file.fullPath)) {
            result.push(new ProjectFileTreeItem(context, file, related));
            processedFiles.add(file.fullPath);
        }
    });

    return result;
}

export async function createItemsFromPackages(childContext: TreeItemContext, packages: PackageReference[], contextValue: string): Promise<TreeItem[]> {
    const result: TreeItem[] = [];
    if (!childContext.project) { return result; }

    const projectDependencies = await childContext.project.getNugetPackageDependencies();
    packages.forEach((pkg) => {
        const pkgDependencies: PackageReference[] = [];
        const key = Object.keys(projectDependencies).find((d) => d.toLocaleLowerCase() === pkg.name.toLocaleLowerCase());
        if (key && projectDependencies[key] && projectDependencies[key].dependencies) {
            Object.keys(projectDependencies[key].dependencies).forEach((d) => {
                pkgDependencies.push(new PackageReference(d, projectDependencies[key].dependencies[d]));
            });
        }

        result.push(
            new ProjectReferencedPackageTreeItem(
                childContext,
                pkg,
                pkgDependencies,
                contextValue
            )
        );
    });

    return result;
}

function getNestedFiles(files: ProjectItemEntry[], relativeFilePath: string): ProjectItemEntry[] {
    const filename = path.basename(relativeFilePath);
    const extension = path.extname(filename);
    const name = path.basename(filename, extension) + ".";
    return files.filter(f => f.name !== filename && f.name.startsWith(name) && f.name.endsWith(extension));
}

function getDependants(files: ProjectItemEntry[], fullFilePath: string): ProjectItemEntry[] {
    const folderPath = path.dirname(fullFilePath);
    return files.filter(f => f.dependentUpon && path.join(folderPath, f.dependentUpon) === fullFilePath);
}