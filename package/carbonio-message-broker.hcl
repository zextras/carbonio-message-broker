services {
  check {
    tcp      = "127.78.0.18:10000"
    timeout  = "1s"
    interval = "5s"
  }
  connect {
    sidecar_service {
      proxy {
        local_service_address = "127.78.0.18"
      }
    }
  }

  name = "carbonio-message-broker"
  port = 10000
}
