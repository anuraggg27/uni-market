declare module "three";

declare module "vanta/dist/vanta.dots.min" {
  const DOTS: (options: Record<string, unknown>) => { destroy: () => void };
  export default DOTS;
}

interface Window {
  THREE?: unknown;
  VANTA?: {
    DOTS: (options: Record<string, unknown>) => { destroy: () => void };
  };
}
