export interface TaskContext {
  taskNumber: number;
  title: string;
  slug: string;
  plansDir: string;
  planPath: string;
  branchName: string;
  cwd: string;
  contextFiles: string[];
  repoUrl?: string;
  trivial?: boolean;
}
