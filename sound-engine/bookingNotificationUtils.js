function normalizeText(value, fallback = "") {
  const trimmed = String(value || "").trim();
  return trimmed || fallback;
}

export function buildPendingBookingEventId(booking) {
  const bookingId = normalizeText(booking?.bookingId, "unknown-booking");
  const createdAtMs = booking?.createdAtMs || "no-time";
  return `booking-pending:${bookingId}:${createdAtMs}`;
}

export function buildPendingBookingMessage(booking) {
  const phaseId = normalizeText(booking?.phaseId, "unknown-phase");
  const userId = normalizeText(booking?.userId, "unknown-user");
  return `New pending booking for phase ${phaseId} from user ${userId}.`;
}

export function findNewPendingBookingEvents(previousBookingsById, nextBookings) {
  const events = [];

  nextBookings.forEach((booking) => {
    if (!booking || booking.status !== "pending") {
      return;
    }

    const previousBooking = previousBookingsById.get(booking.bookingId) || null;
    if (previousBooking?.status === "pending") {
      return;
    }

    events.push({
      type: "booking-pending",
      bookingId: booking.bookingId,
      eventId: buildPendingBookingEventId(booking),
      text: buildPendingBookingMessage(booking)
    });
  });

  return events;
}
