declare module 'leaflet.heat' {
  import * as L from 'leaflet';

  namespace HeatLayer {
    interface Options {
      radius?: number;
      blur?: number;
      maxZoom?: number;
      max?: number;
      minOpacity?: number;
      gradient?: Record<number, string>;
    }
  }

  module 'leaflet' {
    function heatLayer(
      latlngs: Array<[number, number] | [number, number, number]>,
      options?: HeatLayer.Options
    ): L.Layer;
  }
}
