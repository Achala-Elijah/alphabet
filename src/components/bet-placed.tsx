"use client";

import { Check, Ticket } from "lucide-react";
import { formatCustomerAmount } from "@/lib/currency";
import type { BetSlipSelection } from "@/lib/bet-slip";

export type PlacedBetReceipt = {
  ids: string[];
  count: number;
  mode: "multiple" | "singles";
  stake: number;
  potentialReturn: number;
  selections: BetSlipSelection[];
};

/** SportyBet-style receipt shown the moment a bet is accepted. */
export default function BetPlaced({
  receipt,
  currency,
  onClose
}: {
  receipt: PlacedBetReceipt;
  currency: string;
  onClose: () => void;
}) {
  const totalOdds = receipt.selections.reduce((total, selection) => total * Number(selection.odds || 1), 1);
  const isSingles = receipt.mode === "singles";
  return (
    <div className="bet-placed" role="dialog" aria-modal="true" aria-label="Bet placed successfully" onClick={onClose}>
      <div className="bet-placed-card" onClick={(event) => event.stopPropagation()}>
        <span className="bet-placed-icon"><Check size={30} strokeWidth={3} /></span>
        <h2>Bet placed successfully</h2>
        <p>{receipt.count > 1 ? `${receipt.count} single bets accepted` : "Your bet has been accepted"}</p>

        <div className="bet-placed-id">
          <Ticket size={13} />
          <span>{receipt.count > 1 ? "Bet IDs" : "Bet ID"}</span>
          <strong>{receipt.ids.length ? receipt.ids.map((id) => id.slice(0, 8).toUpperCase()).join(", ") : "—"}</strong>
        </div>

        <div className="bet-placed-rows">
          <div><span>Type</span><strong>{isSingles ? `Singles (${receipt.count})` : "Multiple"}</strong></div>
          <div><span>Stake</span><strong>{formatCustomerAmount(receipt.stake, currency)}</strong></div>
          <div><span>Total odds</span><strong>{totalOdds.toFixed(2)}</strong></div>
          <div className="is-highlight"><span>Potential win</span><strong>{formatCustomerAmount(receipt.potentialReturn, currency)}</strong></div>
        </div>

        <div className="bet-placed-selections">
          {receipt.selections.map((selection, index) => (
            <div key={`${selection.matchId}-${selection.market}-${selection.option}-${index}`}>
              <span>{selection.option} @ {Number(selection.odds).toFixed(2)}</span>
              <small>{selection.match} · {selection.market}</small>
              {isSingles && selection.stake ? (
                <em>Stake {formatCustomerAmount(Number(selection.stake), currency)}</em>
              ) : null}
            </div>
          ))}
        </div>

        <button type="button" onClick={onClose}>OK</button>
      </div>
    </div>
  );
}
