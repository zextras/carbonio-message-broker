services {
  check {
    tcp      = "localhost:5672"
    timeout  = "1s"
    interval = "5s"
  }
  connect {
    sidecar_service {
      proxy {
        upstreams = [
          {
            destination_name = "carbonio-message-broker"
            local_bind_address = "127.78.0.15"
            local_bind_port = 20000
          }
        ]
      }
    }
  }

  name = "carbonio-message-broker"
  port = 5672
}
