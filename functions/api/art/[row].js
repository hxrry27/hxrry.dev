import { serveArt } from "../../../lib/lately-endpoint.js";

export const onRequestGet = (context) => serveArt(context, context.params.row);
