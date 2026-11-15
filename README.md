# Carbonio Message Broker

[![Contributors][contributors-badge]][contributors]
[![Activity][activity-badge]][activity]
[![License][license-badge]](COPYING)
[![Project][project-badge]][project]

Message broker through which Carbonio services exchange events.

- Installation: [Carbonio CE guide](https://docs.zextras.com/carbonio-ce/html/install/toc.html)

## Cluster

Every node that installs the package joins the others through Consul: install it and run
`pending-setups` on each node, one at a time.

- Run 1, 3 or 5 nodes. A cluster needs a majority of its nodes up, so 2 nodes stop when either fails.
- Brokers talk to each other outside the service mesh: open TCP 4369 and 25672 between broker nodes
  only.
- Every node must resolve the FQDN of the others.
- Check membership with `rabbitmqctl cluster_status`.

To remove a node for good, run on that node while every node is still up, then purge the package:

```bash
rabbitmq-queues shrink "$(rabbitmqctl eval 'node().' | tr -d "'")"  # move its queue replicas away
rabbitmqctl stop_app
rabbitmqctl reset                                                 # leave the cluster
```

Stopping or uninstalling the broker first leaves a 2-node cluster without a majority, and a reinstalled
node that kept its old data cannot start.

[contributors-badge]: https://img.shields.io/github/contributors/zextras/carbonio-message-broker "Contributors"
[contributors]: https://github.com/zextras/carbonio-message-broker/graphs/contributors "Contributors"
[activity-badge]: https://img.shields.io/github/commit-activity/m/zextras/carbonio-message-broker "Activity"
[activity]: https://github.com/zextras/carbonio-message-broker/pulse "Activity"
[license-badge]: https://img.shields.io/badge/license-AGPL--3.0--only-blue "License"
[project-badge]: https://img.shields.io/badge/project-carbonio-informational "Project Carbonio"
[project]: https://www.zextras.com/carbonio/ "Project Carbonio"
