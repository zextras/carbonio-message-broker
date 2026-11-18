services {
  checks = [
    {
      tcp      = "127.78.0.18:10000"
      timeout  = "1s"
      interval = "5s"
    },
    {
      # a hung broker still accepts TCP connections; only RabbitMQ itself can answer this
      http     = "http://127.78.0.18:15692/metrics/detailed?family=queue_coarse_metrics"
      timeout  = "2s"
      interval = "5s"
      failures_before_critical = 2
    },
  ]
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
