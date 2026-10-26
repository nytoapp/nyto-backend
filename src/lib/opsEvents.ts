import { getChatIo } from "../realtime/chatSocket";

/** Door / inventory realtime — separate event names from chat (`message.*`). */

export function emitDoorCheckedIn(payload: {
  bookingId: string;
  tableId: string;
  venueId: string;
  userId?: string;
  status: "ATTENDED";
}) {
  const io = getChatIo();
  if (!io) return;
  io.to(`venue:${payload.venueId}`).emit("door.checked_in", payload);
  io.to(`table:${payload.tableId}`).emit("door.checked_in", payload);
  if (payload.userId) {
    io.to(`user:${payload.userId}`).emit("door.checked_in", payload);
  }
}

export function emitInventorySeats(payload: {
  tableId: string;
  venueId: string;
  seatsTaken: number;
  seatsLeft: number;
  status: string;
}) {
  const io = getChatIo();
  if (!io) return;
  io.to(`venue:${payload.venueId}`).emit("inventory.seats", payload);
  io.to(`table:${payload.tableId}`).emit("inventory.seats", payload);
}

export function emitBookingCancelled(payload: {
  bookingId: string;
  tableId: string;
  venueId: string;
  userId?: string;
}) {
  const io = getChatIo();
  if (!io) return;
  io.to(`venue:${payload.venueId}`).emit("booking.cancelled", payload);
  io.to(`table:${payload.tableId}`).emit("booking.cancelled", payload);
  if (payload.userId) {
    io.to(`user:${payload.userId}`).emit("booking.cancelled", payload);
  }
}
