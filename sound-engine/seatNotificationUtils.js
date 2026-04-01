function parseSeatNumberFromSeatId(seatId) {
  const parsed = Number.parseInt(String(seatId || "").replace(/[^\d]/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function safeSeatLabel(seat) {
  const seatNumber = Number(seat?.seatNumber);
  if (Number.isFinite(seatNumber) && seatNumber > 0) {
    return seatNumber;
  }
  return parseSeatNumberFromSeatId(seat?.seatId) || "?";
}

function normalizeHolderName(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed || trimmed.toLowerCase() === "unknown user") {
    return "";
  }
  return trimmed;
}

export function buildPendingSeatEventId(seat) {
  const seatId = seat?.seatId || "unknown-seat";
  const holdStart = seat?.holdStartTimeMs || "no-time";
  const heldBy = seat?.heldBy || "unknown-user";
  return `seat-pending:${seatId}:${heldBy}:${holdStart}`;
}

export function buildPendingSeatMessage(seat) {
  const seatLabel = safeSeatLabel(seat);
  const holderName = normalizeHolderName(seat?.heldByName);

  if (holderName) {
    return `Seat ${seatLabel} booked by ${holderName}. New booking request requires approval.`;
  }

  return `Seat ${seatLabel} has been booked. New booking request requires approval.`;
}

export function findNewPendingSeatEvents(previousSeatsById, nextSeats) {
  const events = [];

  nextSeats.forEach((seat) => {
    if (!seat || seat.status !== "pending") {
      return;
    }

    const previousSeat = previousSeatsById.get(seat.seatId) || null;
    const wasPending = previousSeat?.status === "pending";
    if (wasPending) {
      return;
    }

    events.push({
      type: "seat-pending",
      seatId: seat.seatId,
      eventId: buildPendingSeatEventId(seat),
      text: buildPendingSeatMessage(seat)
    });
  });

  return events;
}
