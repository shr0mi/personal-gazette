import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, PenLine, Plus, Trash2 } from "lucide-react";

type Props = {
  points: string[];
  onChange: (points: string[]) => void;
  disabled: boolean;
};

export default function KeyPointsEditor({ points, onChange, disabled }: Props) {
  const [entry, setEntry] = useState("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEntry("");
    setEditingIndex(null);
  }, [points]);

  const submitPoint = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const point = entry.trim();
    if (disabled || !point) return;
    onChange(editingIndex === null ? [...points, point] : points.map((previous, index) => index === editingIndex ? point : previous));
    setEntry("");
    setEditingIndex(null);
    inputRef.current?.focus();
  };

  const editPoint = (index: number) => {
    setEntry(points[index]);
    setEditingIndex(index);
    inputRef.current?.focus();
  };

  return (
    <>
      {points.length > 0 && (
        <ol className="key-points editable-key-points">
          {points.map((point, index) => (
            <li key={index}>
              <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
              <p>{point}</p>
              <div className="key-point-actions">
                <button type="button" className="icon-button" aria-label={`Edit key point ${index + 1}`} aria-pressed={editingIndex === index} onClick={() => editPoint(index)} disabled={disabled}><PenLine size={14} /></button>
                <button type="button" className="icon-button" aria-label={`Remove key point ${index + 1}`} onClick={() => onChange(points.filter((_, pointIndex) => pointIndex !== index))} disabled={disabled}><Trash2 size={14} /></button>
              </div>
            </li>
          ))}
        </ol>
      )}
      <form className="keypoint-entry" onSubmit={submitPoint}>
        <label htmlFor="article-key-point">{editingIndex === null ? "Add a key point" : `Edit key point ${editingIndex + 1}`}</label>
        <div className="keypoint-input-row">
          <input ref={inputRef} id="article-key-point" value={entry} onChange={(event) => setEntry(event.target.value)} placeholder="What stood out to you?" aria-describedby="keypoints-hint" autoComplete="off" spellCheck disabled={disabled} />
          <button type="submit" disabled={disabled || !entry.trim()}>{editingIndex === null ? <Plus size={15} /> : <Check size={15} />}{editingIndex === null ? "Add" : "Update"}</button>
        </div>
        <p id="keypoints-hint" className="field-hint">{editingIndex === null ? "Press Enter or Add to list your point above." : "Press Enter or Update to save this point."}</p>
        {editingIndex !== null && <button type="button" className="text-button cancel-point-edit" onClick={() => { setEntry(""); setEditingIndex(null); inputRef.current?.focus(); }} disabled={disabled}>Cancel edit</button>}
      </form>
    </>
  );
}
