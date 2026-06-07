import { ShipError } from "../errors.js";
import type { Document } from "../types.js";

export interface DocumentsListResult {
  data: Document[];
  next_cursor: string | null;
}

export class DocumentsClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  async create(body: {
    title: string;
    document_type?: string;
  }): Promise<Document> {
    const url = new URL("/api/v1/docs", this.baseUrl);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = (await response.json()) as any;
    if (!response.ok) {
      throw ShipError.fromResponse(
        data.code,
        data.message,
        data.details,
        data.request_id,
      );
    }

    return data as Document;
  }

  async get(documentId: string): Promise<Document> {
    const response = await fetch(
      new URL(`/api/v1/docs/${documentId}`, this.baseUrl),
      {
        headers: {
          Authorization: `Bearer ${this.token}`,
        },
      },
    );

    const body = (await response.json()) as any;
    if (!response.ok) {
      throw ShipError.fromResponse(
        body.code,
        body.message,
        body.details,
        body.request_id,
      );
    }

    return body as Document;
  }

  async list(cursor?: string): Promise<DocumentsListResult> {
    const url = new URL("/api/v1/docs", this.baseUrl);
    if (cursor) {
      url.searchParams.set("cursor", cursor);
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
      },
    });

    const body = (await response.json()) as any;
    if (!response.ok) {
      throw ShipError.fromResponse(
        body.code,
        body.message,
        body.details,
        body.request_id,
      );
    }

    return body as DocumentsListResult;
  }

  async *iterate(): AsyncGenerator<Document, void, void> {
    let cursor: string | undefined;

    while (true) {
      const page = await this.list(cursor);

      for (const document of page.data) {
        yield document;
      }

      if (!page.next_cursor) {
        return;
      }

      cursor = page.next_cursor;
    }
  }
}
