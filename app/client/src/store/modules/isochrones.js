import http from "../../services/http";
import axios from "axios";

import { getField, updateField } from "vuex-map-fields";
import { toStringHDMS } from "ol/coordinate";
import { transform } from "ol/proj.js";

import {
  geojsonToFeature,
  getPolygonArea,
  wktToFeature,
  flyTo
} from "../../utils/MapUtils";
import Feature from "ol/Feature";
import Point from "ol/geom/Point";
import IsochroneUtils from "../../utils/IsochroneUtils";
import { groupBy } from "../../utils/Helpers";
import { getNestedProperty, addProps } from "../../utils/Helpers";

const state = {
  position: {
    coordinate: null,
    placeName: ""
  },
  options: [],
  styleData: {},
  calculations: [],
  multiIsochroneCalculationMethods: {
    name: "multiIsochroneCalculationMethods",
    values: [
      {
        display: "Study Area",
        name: "studyArea",
        value: "study_area"
      },
      {
        display: "Draw Boundary",
        name: "drawBoundary",
        value: "draw"
      }
    ],
    active: null
  },
  isochroneLayer: null,
  selectionLayer: null,
  isochroneRoadNetworkLayer: null,

  isThematicDataVisible: false,
  selectedThematicData: null
};

const getters = {
  routingProfile: state => state.routingProfile,
  calculations: state => state.calculations,
  options: state => state.options,
  isochroneLayer: state => state.isochroneLayer,
  selectionLayer: state => state.selectionLayer,
  styleData: state => state.styleData,
  isThematicDataVisible: state => state.isThematicDataVisible,
  selectedThematicData: state => state.selectedThematicData,
  alphaShapeParameter: state => state.alphaShapeParameter,
  multiIsochroneCalculationMethods: state =>
    state.multiIsochroneCalculationMethods,
  countPois: state => {
    let count = 0;
    if (state.selectionLayer) {
      count = state.selectionLayer
        .getSource()
        .getFeatures()
        .reduce((accumulator, currentValue) => {
          return accumulator + currentValue.get("count_pois");
        }, 0);
    }

    return count;
  },
  getGroupedCalculationData: state => id => {
    const calculation = state.calculations.find(
      calculation => calculation.id === id
    );
    return calculation ? groupBy(calculation.data, "type") : {};
  },
  getField
};

const actions = {
  async calculateIsochrone({ commit, rootState }) {
    //Selected isochrone calculation type. single | multiple
    const calculationType = rootState.isochrones.options.calculationType;
    const sharedParams = {
      user_id: rootState.user.userId,
      minutes: state.options.minutes,
      speed: state.options.speed,
      n: state.options.steps,
      modus: state.options.calculationModes.active
    };
    let isochroneEndpoint;
    let params;

    //Marker Feature for single isochrone calculation;
    let iconMarkerFeature;

    if (calculationType === "single") {
      iconMarkerFeature = new Feature({
        geometry: new Point(
          transform(state.position.coordinate, "EPSG:4326", "EPSG:3857") //TODO: Get source projection from the map here.
        ),
        calculationNumber: state.calculations.length + 1
      });
      commit("ADD_ISOCHRONE_FEATURES", [iconMarkerFeature]);

      params = Object.assign(sharedParams, {
        x: state.position.coordinate[0],
        y: state.position.coordinate[1],
        concavity: state.options.concavityIsochrones.active,
        routing_profile: state.options.routingProfile.active["value"]
      });
      isochroneEndpoint = "isochrone";
    } else {
      const regionType = state.multiIsochroneCalculationMethods.active;
      const regionFeatures = state.selectionLayer.getSource().getFeatures();
      const region = regionFeatures
        .map(feature => {
          if (regionType === "draw") {
            return feature
              .get("regionEnvelope")
              .split(",")
              .map(coord => {
                return `'${coord}'`;
              })
              .toString();
          } else {
            return `'${feature.get("region_name")}'`;
          }
        })
        .toString();

      params = Object.assign(sharedParams, {
        alphashape_parameter: parseFloat(
          state.options.alphaShapeParameter.active
        ),
        region_type: `'${regionType}'`,
        region: region,
        routing_profile: `'${state.options.routingProfile.active["value"]}'`,
        amenities: rootState.pois.selectedPois
          .map(item => {
            return "'" + item.value + "'";
          })
          .toString()
      });
      params.modus = `'${state.options.calculationModes.active}'`;
      isochroneEndpoint = "pois_multi_isochrones";
    }

    const isochronesResponse = await http.post(
      `/api/${isochroneEndpoint}`,
      params
    );
    let isochrones = isochronesResponse.data;
    let calculationData = [];

    //TODO: Don't get calculation options from state at this moment.
    const calculationNumber = state.calculations.length + 1;

    let olFeatures = geojsonToFeature(isochrones, {});
    //Order features based on id
    olFeatures.sort((a, b) => {
      return a.get("step") - b.get("step");
    });

    olFeatures.forEach(feature => {
      feature.getGeometry().transform("EPSG:4326", "EPSG:3857");
      let color = "";
      let level = feature.get("step");
      let modus = feature.get("modus");

      //Remove coordinates property (multi-isochrones not printing, probably a bug. )
      feature.unset("coordinates");
      // If the modus is 1 it is a default isochrone, otherwise is a input or double calculation
      if (modus === 1 || modus === 3) {
        color = state.styleData.defaultIsochroneColors[level];
      } else {
        color = state.styleData.inputIsochroneColors[level];
      }
      let obj = {
        id: feature.getId(),
        type: IsochroneUtils.getIsochroneAliasFromKey(
          feature.getProperties().modus
        ),
        objectId: feature.getProperties().objectid,
        modus: modus,
        range: feature.getProperties().step + " min",
        color: color,
        area: getPolygonArea(feature.getGeometry()),
        isVisible: true
      };
      feature.set("isVisible", true);
      feature.set("calculationNumber", calculationNumber);
      feature.set("color", color);

      calculationData.push(obj);
    });

    let transformedData = {
      id: calculationNumber,
      calculationType: calculationType,
      time: state.options.minutes + " min",
      speed: state.options.speed + " km/h",
      isExpanded: true,
      isVisible: true,
      data: calculationData,
      additionalData: {}
    };

    if (calculationType === "single") {
      const isochroneStartingPoint = wktToFeature(
        olFeatures[0].get("starting_point"),
        "EPSG:4326"
      )
        .getGeometry()
        .getCoordinates();
      const transformedPoint = new Point(
        transform(isochroneStartingPoint, "EPSG:4326", "EPSG:3857") //TODO: Get source projection from the map here.
      );
      iconMarkerFeature.setGeometry(transformedPoint);
      if (state.position.placeName) {
        flyTo(
          transformedPoint.getCoordinates(),
          rootState.map.map,
          function() {}
        );
      }
      transformedData.position =
        state.position.placeName ||
        toStringHDMS(isochroneStartingPoint || state.position.coordinate) ||
        "";
    } else {
      commit("RESET_MULTIISOCHRONE_START");
      transformedData.position = "multiIsochroneCalculation";
    }

    commit("CALCULATE_ISOCHRONE", transformedData);
    //Add features to isochrone layer
    commit("ADD_ISOCHRONE_FEATURES", olFeatures);
  },

  async countStudyAreaPois({ commit, rootState }, options) {
    if (!rootState.isochrones.selectionLayer) return;
    const selectedFeatures = rootState.isochrones.selectionLayer
      .getSource()
      .getFeatures();
    if (selectedFeatures.length > 0 || options) {
      const amenities = rootState.pois.selectedPois
        .map(item => {
          return "'" + item.value + "'";
        })
        .toString();
      if (amenities === "") {
        commit(
          "map/TOGGLE_SNACKBAR",
          {
            type: "error",
            message: "selectAmenities",
            state: true
          },
          { root: true }
        );
        //Reset all study area features count_point property to zero.
        selectedFeatures.forEach(feature => {
          feature.set("count_pois", 0);
        });
        return;
      }
      const params = {
        minutes: rootState.isochrones.options.minutes,
        speed: rootState.isochrones.options.speed,
        amenities: amenities
      };
      let promiseArray = [];
      if (options) {
        promiseArray.push(
          http.post(
            "/api/count_pois_multi_isochrones",
            Object.assign(
              {
                region_type: options.regionType,
                region: options.region
              },
              params
            )
          )
        );
      } else {
        const promises = selectedFeatures.map(feature => {
          return http.post(
            "/api/count_pois_multi_isochrones",
            Object.assign(
              {
                region_type: feature.get("region_type"),
                region: feature.get("region")
              },
              params
            )
          );
        });
        promiseArray = [...promises];
      }

      axios.all(promiseArray).then(results => {
        if (!options) {
          rootState.isochrones.selectionLayer.getSource().clear();
        }

        results.map(response => {
          const configData = JSON.parse(response.config.data);
          if (response.data.feature) {
            const olFeatures = geojsonToFeature(response.data.feature, {});
            olFeatures.forEach(feature => {
              feature.getGeometry().transform("EPSG:4326", "EPSG:3857");
              feature.set("region_type", configData.region_type);
              feature.set("region", configData.region);

              if (configData.region_type === "'draw'") {
                feature.set("regionEnvelope", configData.region);
              }
            });
            commit("ADD_STUDYAREA_FEATURES", olFeatures);
          }
        });
      });
    }
  },

  toggleRoadNetwork({ rootState }, payload) {
    const calculation = payload.calculation;
    addProps(
      calculation.additionalData,
      `${payload.type}.state`,
      payload.state
    );

    if (
      !!getNestedProperty(
        calculation.additionalData,
        `${payload.type}.features`
      ) === false
    ) {
      //Road Network Feature aren't loaded.
      const groupedData = payload.groupedData[payload.type];
      if (!groupedData || groupedData.length < 1) return;
      const objectId = groupedData[0].objectId;
      const modus = groupedData[0].modus;

      addProps(calculation.additionalData, `${payload.type}.features`, []);

      http
        .get("./geoserver/wfs", {
          params: {
            service: "WFS",
            version: " 1.1.0",
            request: "GetFeature",
            viewparams: `objectid:${objectId};modus:${modus}`,
            outputFormat: "application/json",
            typeNames: "cite:show_network"
          }
        })
        .then(function(response) {
          if (response.status === 200) {
            let olFeatures = geojsonToFeature(response.data, {
              dataProjection: "EPSG:4326",
              featureProjection: "EPSG:3857"
            });
            calculation.additionalData[payload.type]["features"] = [
              ...olFeatures
            ];

            if (
              payload.state === true &&
              rootState.isochrones.isochroneRoadNetworkLayer !== null
            ) {
              //1- Add features to road network layer

              rootState.isochrones.isochroneRoadNetworkLayer
                .getSource()
                .addFeatures(olFeatures);
            }
          }
        })
        .catch(function(error) {
          throw new Error(error);
        });
    }

    const features = calculation.additionalData[payload.type]["features"];
    if (payload.state === false && features.length > 0) {
      //2- Remove features from road network layer
      features.forEach(feature => {
        rootState.isochrones.isochroneRoadNetworkLayer
          .getSource()
          .removeFeature(feature);
      });
    } else {
      //3- Add already loaded feature again to the road network layer
      rootState.isochrones.isochroneRoadNetworkLayer
        .getSource()
        .addFeatures(features);
    }
  },

  removeCalculation({ commit }, calculation) {
    commit("REMOVE_CALCULATION", calculation);
  },

  setSelectedThematicData({ commit, rootState }, thematicDataObject) {
    //Assign Selected Pois from the tree
    thematicDataObject.filterSelectedPois = rootState.pois.selectedPois;
    commit("SET_SELECTED_THEMATIC_DATA", thematicDataObject);
  }
};

const mutations = {
  INIT(state, config) {
    if (config && typeof config === "object") {
      for (const key of Object.keys(config)) {
        state[key] = config[key];
      }
    }
  },
  CALCULATE_ISOCHRONE(state, isochrone) {
    state.calculations.unshift(isochrone);
  },
  UPDATE_POSITION(state, position) {
    Object.assign(state.position, position);
  },
  ADD_ISOCHRONE_LAYER(state, layer) {
    state.isochroneLayer = layer;
  },
  ADD_ISOCHRONE_ROAD_NETWORK_LAYER(state, layer) {
    state.isochroneRoadNetworkLayer = layer;
  },
  ADD_SELECTION_LAYER(state, layer) {
    state.selectionLayer = layer;
  },
  RESET_MULTIISOCHRONE_START(state) {
    state.multiIsochroneCalculationMethods.active = null;
  },
  CLEAR_ISOCHRONE_LAYER(state) {
    state.isochroneLayer.getSource().clear();
  },
  REMOVE_CALCULATION(state, calculation) {
    let id = calculation.id;
    state.calculations = state.calculations.filter(
      calculation => calculation.id != id
    );
    state.calculations = state.calculations.map(calculation => {
      if (calculation.id > id) {
        calculation.id = calculation.id - 1;
      }
      return calculation;
    });
    let isochroneSource = state.isochroneLayer.getSource();
    isochroneSource.getFeatures().forEach(isochroneFeature => {
      const isochroneCalculationNr = isochroneFeature.get("calculationNumber");
      if (isochroneCalculationNr === id) {
        isochroneSource.removeFeature(isochroneFeature);
      }
      if (isochroneCalculationNr > id) {
        isochroneFeature.set("calculationNumber", isochroneCalculationNr - 1);
      }
    });
    const isochroneRoadNetworkLayerSource = state.isochroneRoadNetworkLayer.getSource();
    Object.keys(calculation.additionalData).forEach(type => {
      const features = calculation.additionalData[type].features;
      if (isochroneRoadNetworkLayerSource && features) {
        features.forEach(feature => {
          isochroneRoadNetworkLayerSource.removeFeature(feature);
        });
      }
    });
  },
  ADD_ISOCHRONE_FEATURES(state, features) {
    if (state.isochroneLayer) {
      state.isochroneLayer.getSource().addFeatures(features);
    }
  },
  ADD_STUDYAREA_FEATURES(state, features) {
    if (state.selectionLayer) {
      state.selectionLayer.getSource().addFeatures(features);
    }
  },
  REMOVE_STUDYAREA_FEATURES(state) {
    state.selectionLayer.getSource().clear();
  },
  TOGGLE_ISOCHRONE_FEATURE_VISIBILITY(state, feature) {
    let featureId = feature.id;
    feature.isVisible = !feature.isVisible;
    if (featureId) {
      let isochroneFeature = state.isochroneLayer
        .getSource()
        .getFeatureById(featureId);
      if (isochroneFeature) {
        isochroneFeature.set("isVisible", feature.isVisible);
      }
    }
  },
  TOGGLE_ISOCHRONE_CALCULATION_VISIBILITY(state, calculation) {
    calculation.isVisible = !calculation.isVisible;

    calculation.data.forEach(isochrone => {
      let featureId = isochrone.id;
      isochrone.isVisible = calculation.isVisible;
      let isochroneFeature = state.isochroneLayer
        .getSource()
        .getFeatureById(featureId);
      if (isochroneFeature) {
        isochroneFeature.set("isVisible", calculation.isVisible);
      }
    });
  },
  ADD_STYLE_IN_CACHE(state, payload) {
    let style = payload.style;
    let isochroneType = payload.isochroneType;
    let styleName = payload.styleName;
    //Adds style into cache based on isochrone type
    state.styleData.styleCache[isochroneType][styleName] = style;
  },
  updateField,
  TOGGLE_THEMATIC_DATA_VISIBILITY(state, isVisible) {
    state.isThematicDataVisible = isVisible;
  },
  SET_SELECTED_THEMATIC_DATA(state, thematicDataObject) {
    state.selectedThematicData = thematicDataObject;
  }
};

export default {
  namespaced: true,
  state,
  getters,
  actions,
  mutations
};
