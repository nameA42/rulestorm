/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Extra ICE servers for online play, as JSON: one RTCIceServer or an array,
   * e.g. [{"urls":"turn:relay.example.com:443?transport=tcp","username":"u","credential":"p"}].
   * Set at build time (the Pages workflow passes the ICE_SERVERS repo secret).
   */
  readonly VITE_ICE_SERVERS?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
