// Generated from the packaged template on every upgrade and setup:
// local edits to this file are overwritten.
// To change the values, set them in /etc/zextras/service-discover/carbonio-message-broker.env
// (KEY=value lines; keys and defaults are printed at the end of carbonio-message-broker setup),
// then run carbonio-message-broker setup.

services {
  check {
    tcp      = "127.78.0.18:10000"
    timeout  = "{{ or (env "CHECK_TIMEOUT") "1s" }}"
    interval = "{{ or (env "CHECK_INTERVAL") "5s" }}"
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
