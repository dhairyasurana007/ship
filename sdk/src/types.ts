export interface User {
  id: string;
  name: string;
  email: string;
  granted_scopes: string[];
}

export interface Document {
  id: string;
  title: string;
  document_type: string;
  created_at: string;
  updated_at: string;
}
