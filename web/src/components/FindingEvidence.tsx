import { findingGroupNote, findingScope, type ChangeFinding } from "@tracetray/shared";

export default function FindingEvidence({ finding }: { finding: ChangeFinding }) {
  return <div className="advice-item">
    <b>Original finding</b>
    <p>{finding.evidence}</p>
    <p className="note">{findingScope(finding)}</p>
    <p className="note">Analysis saved {finding.ran_at.slice(0, 10)} (UTC). Group: {finding.group}.</p>
    {findingGroupNote(finding) && <p className="note">{findingGroupNote(finding)}</p>}
    <p>Change to try: {finding.action}</p>
    <p className="note">This is a suggestion, not an explanation of what caused the finding.</p>
  </div>;
}
