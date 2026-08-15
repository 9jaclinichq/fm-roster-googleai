import { FolderNode } from '../../../types';

// Default 7-folder Drive taxonomy stamped onto every new research
// workspace's `folder_tree` column at creation time (see
// databaseService.createResearchWorkspace). Purely a client-side document
// organization convention — there's no actual file storage wired to these
// folders yet (see ResearchWorkspaceView's AI Copilot / navigator panel);
// each folder is just a labeled bucket a resident can file document links
// or notes under.
export function buildDefaultFolderTree(): FolderNode[] {
  return [
    { name: '00-Proposal', children: subfolders(['Submitted-Final', 'Supervisor-Corrections', 'Synopsis-of-Corrections', 'Working-Drafts']) },
    { name: '01-Literature', children: subfolders(['Annotated-Bibliographies', 'Literature-Matrix', 'PDFs-Zotero Backup', 'Search-Strategy']) },
    { name: '02-Methodology', children: subfolders(['Ethics', 'Instruments', 'Pretest']) },
    { name: '03-Data-Collection', children: subfolders(['Cleaned-Data', 'Participant-Logs', 'Raw Data', 'DATA ENTRY TRACKER', 'RECRUITMENT LOG']) },
    { name: '04-Analysis', children: subfolders(['Results-Drafts', 'SPSS-Output', 'Statistical Notes']) },
    { name: '05-Writeup', children: subfolders(['Chapter-Drafts', 'Final-Submission', 'Supervisor-Feedback']) },
    { name: '06-Guidelines-and-Resources', children: subfolders(['College-Guidelines', 'Reference-Papers', 'WACP Standards']) },
    { name: '07-Admin', children: subfolders(['Ethics-Approval', 'Supervisor-Correspondence', 'Timeline']) },
  ];
}

function subfolders(names: string[]): FolderNode[] {
  return names.map(name => ({ name }));
}
