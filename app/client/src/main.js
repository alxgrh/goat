// The Vue build version to load with the `import` command
// (runtime-only or standalone) has been set in webpack.base.conf with an alias.
import Vue from "vue";

import vuetify from "@/plugins/vuetify";

import "./plugins/vuescroll";
// Plugins
import i18n from "./plugins/i18n";
import FlagIcon from "vue-flag-icon";
Vue.use(FlagIcon);

// Application imports
import App from "./App";
import UrlUtil from "./utils/Url";
import store from "./store/index";

require("../node_modules/ol/ol.css");
require("./assets/scss/app.scss");

Vue.config.productionTip = false;

// Detect isEmbedded state by attribute embedded and
// make accessible for all components
// recommended by https://vuejs.org/v2/cookbook/adding-instance-properties.html
const appEl = document.querySelector("#app");
Vue.prototype.$isEmbedded = appEl.hasAttribute("embedded");

// Detect an URL parameter for a custom app context
const appCtx = UrlUtil.getQueryParam("appCtx");
let appCtxFile = "";
if (appCtx) {
  // simple approach to avoid path traversal
  appCtxFile = "-" + appCtx.replace(/(\.\.[/])+/g, "");
}

fetch("static/app-conf" + appCtxFile + ".json")
  .then(function(response) {
    return response.json();
  })
  .then(function(appConfig) {
    // make app config accessible for all components
    Vue.prototype.$appConfig = appConfig;
    /* eslint-disable no-new */
    new Vue({
      el: "#app",
      i18n,
      store,
      vuetify,
      render: h => h(App)
    });
  });
