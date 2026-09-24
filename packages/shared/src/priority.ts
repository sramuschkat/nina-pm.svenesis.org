/**
 * Vorschlag der Einfügeposition bei der Freigabe (FA-FRG-16, AP-13e): Stimmen ordnen, planen aber nicht.
 * Die Rig-Priorität wird von oben durchlaufen; das neue Projekt kommt vor das erste freigegebene
 * Projekt, das bei seiner Freigabe **weniger** Stimmen hatte (Gleichstand: dahinter). Ohne ein solches
 * Projekt ans Ende – wie die Freigabe ohne Positionsangabe. Der Admin übernimmt oder ändert den Wert.
 */
export interface PriorityPeer {
  readonly projectId: string;
  /** Endstand der Stimmen bei der Freigabe (approval_event `approved`). */
  readonly votes: number;
}

/** Position 1…n+1 in der Prioritätsreihenfolge `peers` (oben = 1). */
export function suggestPriorityPosition(votes: number, peers: readonly PriorityPeer[]): number {
  const i = peers.findIndex((p) => p.votes < votes);
  return i < 0 ? peers.length + 1 : i + 1;
}
