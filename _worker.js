const OPENAI_PIXEL_SCRIPT = `
  <!-- OpenAI Ads Measurement Pixel -->
  <script>
    (function (w, d, s, u) {
      if (w.oaiq) return;
      var q = function () { q.q.push(arguments); };
      q.q = [];
      w.oaiq = q;
      var js = d.createElement(s);
      js.async = true;
      js.src = u;
      var f = d.getElementsByTagName(s)[0];
      f.parentNode.insertBefore(js, f);
    })(window, document, "script", "https://bzrcdn.openai.com/sdk/oaiq.min.js");
    oaiq("init", { pixelId: "ASWYvC7c9ygeDn78fUwQf" });

    function white5_report_openai_lead() {
      if (typeof oaiq === "function") {
        oaiq("measure", "lead_created", { type: "customer_action" });
      }
    }

    (function () {
      function wrapLeadFunction(name) {
        var original = window[name];
        if (typeof original !== "function" || original.__white5OpenAIWrapped) return;
        window[name] = function () {
          white5_report_openai_lead();
          return original.apply(this, arguments);
        };
        window[name].__white5OpenAIWrapped = true;
      }

      function patchLeadTracking() {
        wrapLeadFunction("white5_report_conversion_event");
        wrapLeadFunction("gtag_report_conversion");
      }

      patchLeadTracking();
      document.addEventListener("DOMContentLoaded", patchLeadTracking);
      window.addEventListener("load", patchLeadTracking);
    })();
  </script>
`;

class HeadInjector {
  element(element) {
    element.append(OPENAI_PIXEL_SCRIPT, { html: true });
  }
}

export default {
  async fetch(request, env, ctx) {
    const response = await env.ASSETS.fetch(request);
    const contentType = response.headers.get("content-type") || "";

    if (!contentType.includes("text/html")) {
      return response;
    }

    return new HTMLRewriter()
      .on("head", new HeadInjector())
      .transform(response);
  }
};
