services {
  checks = [],

  connect {
    sidecar_service {
      proxy {
        local_service_address = "127.78.0.16"
        upstreams             = []
      }
    }
  }

  name = "carbonio-message-broker-webstomp"
  port = 10000
}