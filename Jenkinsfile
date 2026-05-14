// SPDX-FileCopyrightText: 2025 Zextras <https://www.zextras.com>
//
// SPDX-License-Identifier: AGPL-3.0-only

library(
    identifier: 'jenkins-lib-common@dt3-pipeline',
    retriever: modernSCM([
        $class: 'GitSCMSource',
        credentialsId: 'jenkins-integration-with-github-account',
        remote: 'git@github.com:zextras/jenkins-lib-common.git',
    ])
)

// carbonio-message-broker builds RabbitMQ from source (Erlang/Elixir) and produces
// deb/rpm packages + two Docker images (broker and sidecar). No Java build is needed.
// The PKGBUILD has Zextras makedepends (carbonio-elixir, carbonio-erlang) so
// zextrasRepoCredentialsId handles Zextras repo injection for all distros.
// prepare: true triggers 'yap prepare' before building (matching existing behavior).
dt3_pipeline(
    repoName: 'carbonio-message-broker',
    packaging: [
        pkgbuildPath: 'package/PKGBUILD',
        prepare: true,
        zextrasRepoCredentialsId: 'artifactory-jenkins-gradle-properties-splitted',
    ],
    docker: [
        [
            dockerfile: 'docker/Dockerfile',
            imageName: 'carbonio-message-broker',
            title: 'Carbonio Message Broker',
            description: 'Carbonio Message Broker Service',
        ],
        [
            dockerfile: 'docker/sidecar/Dockerfile',
            imageName: 'carbonio-message-broker-sidecar',
            title: 'Carbonio Message Broker Sidecar',
            description: 'Carbonio Message Broker Sidecar Service',
        ],
    ],
    reuse: [projectType: 'ADVANCED'],
)
