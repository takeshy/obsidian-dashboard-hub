import { normalizePath, TFile, TFolder, type Vault } from "obsidian";

function collectFiles(folder: TFolder, result: TFile[]): void {
  for (const child of folder.children) {
    if (child instanceof TFile) result.push(child);
    else if (child instanceof TFolder) collectFiles(child, result);
  }
}

/** Return files below one configured folder without walking the whole vault. */
export function filesInVaultFolder(vault: Vault, folderPath: string): TFile[] {
  const normalized = normalizePath(folderPath).replace(/^\/+|\/+$/g, "");
  if (!normalized) return [];
  const folder = vault.getFolderByPath(normalized);
  if (!folder) return [];
  const result: TFile[] = [];
  collectFiles(folder, result);
  return result;
}

export function pathIsInVaultFolder(path: string, folderPath: string): boolean {
  const normalized = normalizePath(folderPath).replace(/^\/+|\/+$/g, "");
  return !!normalized && path.toLocaleLowerCase().startsWith(`${normalized}/`.toLocaleLowerCase());
}
