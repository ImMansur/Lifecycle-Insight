import { useState } from "react";

/**
 * Some CoC line-item descriptions embed the entire spec paragraph (rated
 * pressure/temperature, NACE compliance, etc.) alongside the equipment name
 * — that's genuinely what's printed in the source document's Description
 * cell (verified against the raw table extraction), not a mis-parse. It's
 * just too long to show inline in a compact row/table cell, so truncate
 * with a "Show more" toggle instead of dropping any of the extracted text.
 */
export function TruncatedText({
  text,
  limit = 160,
}: {
  text: string;
  limit?: number;
}) {
  const [expanded, setExpanded] = useState(false);

  if (text.length <= limit) return <>{text}</>;

  return (
    <>
      {expanded ? text : text.slice(0, limit).trimEnd() + "…"}{" "}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setExpanded((v) => !v);
        }}
        className="font-semibold text-primary hover:underline"
      >
        {expanded ? "Show less" : "Show more"}
      </button>
    </>
  );
}
