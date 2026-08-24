import http from "http";
import { createApp } from "./app";
import { env } from "./config/env";
import { attachChatSocket } from "./realtime/chatSocket";

const app = createApp();
const server = http.createServer(app);
attachChatSocket(server);

server.listen(env.PORT, () => {
  console.log(`NYTO API listening on http://localhost:${env.PORT}`);
  console.log(
    `Table chat grace: ${env.TABLE_CHAT_GRACE_PERIOD_HOURS}h after ${env.TABLE_EVENT_DURATION_HOURS}h event`,
  );
});
