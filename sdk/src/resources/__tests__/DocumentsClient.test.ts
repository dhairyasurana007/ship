import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentsClient } from "../DocumentsClient.js";

describe("DocumentsClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fetches a document by id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "doc-1",
          title: "Doc",
          document_type: "wiki",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    vi.stubGlobal("fetch", fetchMock);

    const client = new DocumentsClient("https://ship.test", "token-123");
    const doc = await client.get("doc-1");

    expect(doc.id).toBe("doc-1");
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("/api/v1/docs/doc-1", "https://ship.test"),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer token-123",
        }),
      }),
    );
  });

  it("iterates documents across cursor pages", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              { id: "doc-1", title: "Doc 1", document_type: "wiki" },
              { id: "doc-2", title: "Doc 2", document_type: "wiki" },
            ],
            next_cursor: "cursor-2",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ id: "doc-3", title: "Doc 3", document_type: "wiki" }],
            next_cursor: null,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      );

    vi.stubGlobal("fetch", fetchMock);

    const client = new DocumentsClient("https://ship.test", "token-123");
    const titles: string[] = [];

    for await (const document of client.iterate()) {
      titles.push(document.title);
    }

    expect(titles).toEqual(["Doc 1", "Doc 2", "Doc 3"]);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      new URL("/api/v1/docs", "https://ship.test"),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer token-123",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      new URL("/api/v1/docs?cursor=cursor-2", "https://ship.test"),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer token-123",
        }),
      }),
    );
  });
});
