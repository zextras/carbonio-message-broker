services {
  checks = [],

  connect {
    sidecar_service {
      proxy {
        local_service_address = "127.78.0.17"
        upstreams             = []
      }
    }
  }

  name = "carbonio-message-broker-http"
  port = 10000
}