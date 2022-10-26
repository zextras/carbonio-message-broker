services {
  checks = [],

  connect {
    sidecar_service {
      proxy {
        local_service_address = "127.78.0.15"
        upstreams             = []
      }
    }
  }

  name = "carbonio-message-broker"
  port = 10000
}