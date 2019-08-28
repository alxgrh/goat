import OlBaseController from "./OlBaseController";
import OlStyleDefs from "../style/OlStyleDefs";
import VectorSource from "ol/source/Vector";
import VectorLayer from "ol/layer/Vector";
import DrawInteraction, { createBox } from "ol/interaction/Draw";
import { unByKey } from "ol/Observable";
import { getAllChildLayers } from "../utils/Layer";
import { transform } from "ol/proj.js";
import store from "../store/index.js";
export default class OlIsochroneController extends OlBaseController {
  constructor(map) {
    super(map);
  }

  /**
   * Creates the study area selection vector layer and add it to the
   * map.
   */
  createSelectionLayer() {
    const me = this;
    const selectionSource = new VectorSource({
      wrapX: false
    });
    const selectionLayer = new VectorLayer({
      displayInLayerList: false,
      zIndex: 4,
      source: selectionSource,
      style: OlStyleDefs.getFeatureHighlightStyle()
    });
    me.map.addLayer(selectionLayer);
    me.selectionSource = selectionSource;
    store.commit("isochrones/ADD_SELECTION_LAYER", selectionLayer);
  }

  /**
   * Creates and adds the necessary draw interaction and adds it to the map.
   */
  addInteraction(calculationType) {
    const me = this;
    me.clear();
    me.createHelpTooltip();
    me.pointerMoveKey = me.map.on("pointermove", me.onPointerMove.bind(me));
    //Add Interaction for single|multiple calculation type...
    if (calculationType === "single") {
      console.log("single...");
    } else {
      if (
        store.state.isochrones.multiIsochroneCalculationMethods.active ===
        "study_area"
      ) {
        //Study are method
        if (!me.studyAreaLayer) {
          me.studyAreaLayer = getAllChildLayers(me.map).filter(
            layer => layer.get("name") === "study_area_administration"
          );
        }
        if (me.studyAreaLayer.length > 0) {
          me.studyAreaLayer[0].setVisible(true);
        }
        me.setupMapClick();
        me.multiIsoCalcMethod = "study_area";
        me.helpMessage = "Click to select the study area.";
      } else {
        //Draw Boundary box method
        const drawBoundary = new DrawInteraction({
          type: "Circle",
          geometryFunction: createBox()
        });

        drawBoundary.on("drawstart", me.onDrawStart.bind(me));
        drawBoundary.on("drawend", me.onDrawEnd.bind(me));
        me.map.addInteraction(drawBoundary);
        // make select interaction available as member
        me.drawBoundary = drawBoundary;
        me.helpMessage = "Click to start drawing the boundary.";
        me.multiIsoCalcMethod = "draw";
      }
    }
  }

  /**
   * Add a map click interaction to let the user select multiple
   * study-areas for multi-isochrone calculation
   */
  setupMapClick() {
    const me = this;
    const map = me.map;
    me.mapClickListenerKey = map.on("click", evt => {
      //Check if there is a feature already selected at clicked coordinate,
      //and if so, delete it and return.
      const featureAtCoord = me.selectionSource.getFeaturesAtCoordinate(
        evt.coordinate
      );
      if (featureAtCoord.length > 0) {
        me.selectionSource.removeFeature(featureAtCoord[0]);
        me.helpTooltipElement.innerHTML = me.helpMessage;
        return;
      }

      const region = transform(
        evt.coordinate,
        "EPSG:3857",
        "EPSG:4326"
      ).toString();

      const regionType = "'study_area'";
      store.dispatch("isochrones/countStudyAreaPois", {
        regionType,
        region
      });
    });
  }

  /**
   * Draw interaction start event handler
   */
  onDrawStart() {
    const me = this;
    me.selectionSource.clear();
    me.helpMessage = "Click to finish drawing.";
  }

  /**
   * Draw interaction end event handler
   */
  onDrawEnd(evt) {
    const me = this;
    const feature = evt.feature;
    const region = feature
      .getGeometry()
      .clone()
      .transform("EPSG:3857", "EPSG:4326")
      .getExtent()
      .toString();

    const regionType = "'draw'";
    store.dispatch("isochrones/countStudyAreaPois", {
      regionType,
      region
    });
    me.helpMessage = "Click to start drawing.";
    me.helpTooltipElement.innerHTML = me.helpMessage;
  }

  /**
   * Event for updating the edit help tooltip
   */
  onPointerMove(evt) {
    const me = this;
    const coordinate = evt.coordinate;
    if (
      me.multiIsoCalcMethod === "study_area" &&
      me.selectionSource.getFeaturesAtCoordinate(coordinate).length > 0
    ) {
      me.helpTooltipElement.innerHTML = "Click to remove it";
    } else {
      me.helpTooltipElement.innerHTML = me.helpMessage;
    }

    me.helpTooltip.setPosition(coordinate);
  }

  /**
   * Removes the current area selection interaction.
   */
  removeInteraction() {
    const me = this;
    // cleanup possible old select interaction
    if (me.drawBoundary) {
      me.map.removeInteraction(me.drawBoundary);
    }
    if (me.mapClickListenerKey) {
      unByKey(me.mapClickListenerKey);
    }
    if (me.pointerMoveKey) {
      unByKey(me.pointerMoveKey);
    }
    me.multiIsoCalcMethod = null;
  }

  clear() {
    super.clear();
    const me = this;
    if (me.selectionSource) {
      me.selectionSource.clear();
    }
    if (me.studyAreaLayer) {
      me.studyAreaLayer[0].setVisible(false);
    }
  }
}
