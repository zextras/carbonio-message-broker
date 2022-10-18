services {
  kind  = "connect-proxy"
  name  = "carbonio-message-broker-sidecar-proxy"
  port  = 20200
  checks = [
    {
      Name = "Connect Sidecar Listening"
      TCP = "127.78.0.15:20200"
      Interval = "10s"
    },
    {
      name = "Connect Sidecar Aliasing web"
      alias_service = "carbonio-message-broker"
    }
  ]
  proxy = {
    destination_service_id = "carbonio-message-broker"
    destination_service_name = "carbonio-message-broker"
    local_service_address = "127.78.0.15"
    local_service_port = 10000
  }
}