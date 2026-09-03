const GST_RATE = 0.05;

export function moneyFor(seatPrice: number, seats: number) {
  const seatSubtotal = seatPrice * seats;
  const gst = Math.round(seatSubtotal * GST_RATE);
  return {
    seatSubtotal,
    gst,
    total: seatSubtotal + gst,
  };
}
