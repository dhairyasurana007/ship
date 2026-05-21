export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type Category =
  | 'auth'
  | 'websocket'
  | 'input'
  | 'dependency'
  | 'cors-csp'
  | 'secrets'
  | 'rate-limiting'
  | 'error-verbosity';

export type Status = 'vulnerable' | 'pass' | 'inconclusive';

export interface Finding {
  id: string;
  category: Category;
  title: string;
  severity: Severity;
  status: Status;
  description: string;
  reproduction: string;
  evidence: {
    request?: string;
    response?: string;
    expected: string;
    actual: string;
  };
  remediation: string;
  cve?: string;
  affectedFeature?: string;
}

export interface Report {
  generated: string;
  target: string;
  summary: {
    total: number;
    vulnerable: number;
    passed: number;
    inconclusive: number;
    bySeverity: Record<Severity, number>;
    byCategory: Partial<Record<Category, number>>;
  };
  findings: Finding[];
}
