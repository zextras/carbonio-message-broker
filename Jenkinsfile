// SPDX-FileCopyrightText: 2025 Zextras <https://www.zextras.com>
//
// SPDX-License-Identifier: AGPL-3.0-only

library(
    identifier: 'jenkins-lib-common@v4.10.2',
    retriever: modernSCM([
        $class: 'GitSCMSource',
        credentialsId: 'jenkins-integration-with-github-account',
        remote: 'git@github.com:zextras/jenkins-lib-common.git',
    ])
)

// carbonio-message-broker builds RabbitMQ from source (Erlang/Elixir) and produces
// deb/rpm packages + two Docker images (broker and sidecar). No Java build is needed.
// The PKGBUILD has Zextras makedepends (carbonio-elixir, carbonio-erlang), so we build the
// per-distro matrix (lib default) — the standard path where addCarbonioRepos
// wires the Carbonio --repo per distro. Generic single-pkg mode skips repo wiring, which
// leaves those makedeps unresolvable. prepare: true triggers 'yap prepare' before building.
dt3_pipeline(
    repoName: 'carbonio-message-broker',
    packaging: [
        prepare: true,
        addCarbonioRepos: true,
    ],
    docker: [
        [
            dockerfile: 'docker/Dockerfile',
            platforms: ['linux/amd64', 'linux/arm64'] as Set,
            imageName: 'carbonio-message-broker',
            title: 'Carbonio Message Broker',
            description: 'Carbonio Message Broker Service',
        ],
        [
            dockerfile: 'docker/sidecar/Dockerfile',
            platforms: ['linux/amd64', 'linux/arm64'] as Set,
            imageName: 'carbonio-message-broker-sidecar',
            title: 'Carbonio Message Broker Sidecar',
            description: 'Carbonio Message Broker Sidecar Service',
        ],
    ],
    reuse: [projectType: 'ADVANCED'],
)
