import { GeoJSON } from "ol/format";
import http from "../services/http";

/**
 * Util class for OL ways layer.
 */
const WaysLayerHelper = {
  featuresIDsToDelete: [],
  selectedWayType: "road",
  filterResults(response, source) {
    const waysFeatures = new GeoJSON().readFeatures(response.first.data);
    const waysModified = new GeoJSON().readFeatures(response.second.data);
    source.addFeatures(waysFeatures);
    const userInputFeaturesWithOriginId = [];
    const originIdsArr = [];
    const userInputFeaturesNoOriginId = [];

    waysModified.forEach(feature => {
      const id = parseInt(feature.getId().split(".")[1]);
      feature.setId(id);
      if (feature.getProperties().original_id != null) {
        userInputFeaturesWithOriginId.push(feature);
        originIdsArr.push(feature.getProperties().original_id);
      } else {
        userInputFeaturesNoOriginId.push(feature);
      }
    });

    waysFeatures.forEach(feature => {
      const originId = feature.getProperties().id;
      if (
        originIdsArr.includes(originId) ||
        WaysLayerHelper.featuresIDsToDelete.includes(originId.toString())
      ) {
        source.removeFeature(feature);
      }
    });

    source.addFeatures([
      ...userInputFeaturesWithOriginId,
      ...userInputFeaturesNoOriginId
    ]);
  },
  deleteFeature(feature, source, userid) {
    const props = feature.getProperties();
    if (props.hasOwnProperty("original_id")) {
      if (props.original_id !== null) {
        const fid = feature.getProperties().original_id.toString();
        WaysLayerHelper.featuresIDsToDelete.push(fid);
        WaysLayerHelper.commitDelete(
          "delete",
          userid,
          WaysLayerHelper.featuresIDsToDelete,
          props.id
        );
        WaysLayerHelper.commitDelete(
          "update",
          userid,
          WaysLayerHelper.featuresIDsToDelete
        );
      } else {
        WaysLayerHelper.commitDelete(
          "delete",
          userid,
          WaysLayerHelper.featuresIDsToDelete,
          props.id
        );
      }
    } else {
      let fid;
      if (!props.hasOwnProperty("original_id") && !props.hasOwnProperty("id")) {
        fid = feature.getId().toString();
        WaysLayerHelper.commitDelete(
          "delete",
          userid,
          WaysLayerHelper.featuresIDsToDelete,
          fid
        );
      } else {
        fid = feature.getProperties().id.toString();
        WaysLayerHelper.featuresIDsToDelete.push(fid);
        WaysLayerHelper.commitDelete(
          "update",
          userid,
          WaysLayerHelper.featuresIDsToDelete
        );
      }
    }
    source.removeFeature(feature);
  },
  commitDelete(mode, user_id, deleted_feature_ids, drawn_fid) {
    fetch("/api/userdata", {
      method: "POST",
      body: JSON.stringify({
        mode: mode,
        user_id: user_id,
        deleted_feature_ids: deleted_feature_ids,
        drawned_fid: drawn_fid
      }),
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      }
    })
      .then(function(data) {
        return data.json();
      })
      .then(function(json) {
        if (mode == "read") {
          WaysLayerHelper.featuresIDsToDelete = json[0].deleted_feature_ids;
        }
      })
      .catch(function() {
        WaysLayerHelper.insertUserInDb("insert", user_id);
      });
  },
  uploadWaysFeatures(userId, streetSource) {
    http
      .get("./geoserver/wfs", {
        params: {
          service: "WFS",
          version: " 1.1.0",
          request: "GetFeature",
          viewparams: `userid:${userId}`,
          typeNames: "cite:network_modification"
        }
      })
      .then(function(response) {
        if (response.status === 200) {
          //Update Feature Line type
          streetSource.getFeatures().forEach(feature => {
            const prop = feature.getProperties();
            if (prop.hasOwnProperty("status")) {
              feature.setProperties({
                status: 1
              });
            }
          });
        }
      })
      .catch(function(error) {
        throw new Error(error);
      });
  },
  insertUserInDb(mode, generatedId) {
    fetch("/api/userdata", {
      method: "POST",
      body: JSON.stringify({
        mode: mode,
        id: generatedId
      }),
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      }
    }).then(function(data) {
      return data.json;
    });
  }
};

export default WaysLayerHelper;
