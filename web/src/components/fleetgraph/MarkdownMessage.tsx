import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownMessageProps {
  content: string;
}

export function MarkdownMessage({ content }: MarkdownMessageProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ ...props }) => <a {...props} className="underline" target="_blank" rel="noreferrer" />,
        p: ({ ...props }) => <p {...props} className="mb-1 last:mb-0" />,
        ul: ({ ...props }) => <ul {...props} className="mb-1 list-disc pl-4 last:mb-0" />,
        ol: ({ ...props }) => <ol {...props} className="mb-1 list-decimal pl-4 last:mb-0" />,
        li: ({ ...props }) => <li {...props} className="mb-0.5 last:mb-0" />,
        code: ({ ...props }) => <code {...props} className="rounded bg-muted px-1 py-0.5" />,
        pre: ({ ...props }) => <pre {...props} className="my-1 overflow-x-auto rounded bg-muted p-2" />,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
