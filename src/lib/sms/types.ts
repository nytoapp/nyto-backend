export type SmsMessage = {
  /** Destination in E.164. */
  to: string;
  body: string;
  /** Bare OTP code — providers with template APIs send this instead of `body`. */
  code: string;
};

export type SmsTransport = {
  readonly name: string;
  /** Whether the transport has the credentials it needs to actually deliver. */
  isConfigured(): boolean;
  send(message: SmsMessage): Promise<void>;
};
