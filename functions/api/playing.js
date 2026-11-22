import { serveRow } from "../../lib/lately-endpoint.js";

export const onRequestGet = (context) => serveRow(context, "playing");
