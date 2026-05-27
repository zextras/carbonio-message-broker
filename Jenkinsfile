// SPDX-FileCopyrightText: 2025 Zextras <https://www.zextras.com>
//
// SPDX-License-Identifier: AGPL-3.0-only

library(
    identifier: 'jenkins-dt3-lib@v1.2.0',
    retriever: modernSCM([
        $class: 'GitSCMSource',
        remote: 'git@github.com:zextras/jenkins-dt3-lib.git',
        credentialsId: 'jenkins-integration-with-github-account'
    ])
)

library(
    identifier: 'jenkins-lib-common@v2.8.7',
    retriever: modernSCM([
        $class: 'GitSCMSource',
        credentialsId: 'jenkins-integration-with-github-account',
        remote: 'git@github.com:zextras/jenkins-lib-common.git',
    ])
)

properties(defaultPipelineProperties())

pipeline {
    agent {
        node {
            label 'zextras-v1'
        }
    }

    environment {
        LC_ALL = 'C.UTF-8'
    }

    options {
        buildDiscarder(logRotator(numToKeepStr: '25'))
        skipDefaultCheckout()
        timeout(time: 30, unit: 'MINUTES')
    }

    parameters {
        booleanParam(
            name: 'PREPARE_RELEASE',
            defaultValue: false,
            description: 'Check this to prepare a new release (creates pre-release branch and PR)'
        )
    }

    stages {
        stage('Setup') {
            steps {
                checkout scm
                script {
                    gitMetadata()
                }
            }
        }

        stage('Build and Publish Docker Images') {
            steps {
                buildAndPublishDockerImage(
                        projectName: 'carbonio-message-broker',
                        dockerfile: 'docker/Dockerfile',
                        imageTitle: 'Carbonio Message Broker',
                        imageDescription: 'Carbonio Message Broker Service'
                )
                buildAndPublishDockerImage(
                        projectName: 'carbonio-message-broker-sidecar',
                        dockerfile: 'docker/sidecar/Dockerfile',
                        imageTitle: 'Carbonio Message Broker Sidecar',
                        imageDescription: 'Carbonio Message Broker Sidecar Service'
                )
            }
        }

        stage('Build deb/rpm') {
            steps {
                withCredentials([
                    usernamePassword(
                        credentialsId: 'artifactory-jenkins-gradle-properties-splitted',
                        passwordVariable: 'SECRET',
                        usernameVariable: 'USERNAME'
                    )
                ]) {
                    script {
                        env.REPO_ENV = env.GIT_TAG ? 'rc' : 'devel'
                    }
                    buildPackages([
                        buildStageConfig: [
                            prepare: true,
                            overrides: [
                                'ubuntu-jammy': [
                                    preBuildScript: '''
                                        echo "machine zextras.jfrog.io" >> auth.conf
                                        echo "login ''' + USERNAME + '''" >> auth.conf
                                        echo "password ''' + SECRET + '''" >> auth.conf
                                        mv auth.conf /etc/apt
                                        echo "deb [trusted=yes] https://zextras.jfrog.io/artifactory/ubuntu-''' + env.REPO_ENV + ''' jammy main" \
                                        > zextras.list
                                        mv zextras.list /etc/apt/sources.list.d/
                                    '''
                                ],
                                'ubuntu-noble': [
                                    preBuildScript: '''
                                        echo "machine zextras.jfrog.io" >> auth.conf
                                        echo "login ''' + USERNAME + '''" >> auth.conf
                                        echo "password ''' + SECRET + '''" >> auth.conf
                                        mv auth.conf /etc/apt
                                        echo "deb [trusted=yes] https://zextras.jfrog.io/artifactory/ubuntu-''' + env.REPO_ENV + ''' noble main" \
                                        > zextras.list
                                        mv zextras.list /etc/apt/sources.list.d/
                                    '''
                                ],
                                'rocky-8': [
                                    preBuildScript: '''
                                        echo "[Zextras]" > zextras.repo
                                        echo "name=Zextras" >> zextras.repo
                                        echo "baseurl=https://''' + USERNAME + ':' + SECRET + '''@zextras.jfrog.io/artifactory/centos8-''' + env.REPO_ENV + '''/" >> zextras.repo
                                        echo "enabled=1" >> zextras.repo
                                        echo "gpgcheck=0" >> zextras.repo
                                        echo "gpgkey=https://''' + USERNAME + ':' + SECRET + '''@zextras.jfrog.io/artifactory/centos8-''' + env.REPO_ENV + '''/repomd.xml.key" >> zextras.repo
                                        mv zextras.repo /etc/yum.repos.d/zextras.repo
                                    '''
                                ],
                                'rocky-9': [
                                    preBuildScript: '''
                                        echo "[Zextras]" > zextras.repo
                                        echo "name=Zextras" >> zextras.repo
                                        echo "baseurl=https://''' + USERNAME + ':' + SECRET + '''@zextras.jfrog.io/artifactory/rhel9-''' + env.REPO_ENV + '''/" >> zextras.repo
                                        echo "enabled=1" >> zextras.repo
                                        echo "gpgcheck=0" >> zextras.repo
                                        echo "gpgkey=https://''' + USERNAME + ':' + SECRET + '''@zextras.jfrog.io/artifactory/rhel9-''' + env.REPO_ENV + '''/repomd.xml.key" >> zextras.repo
                                        mv zextras.repo /etc/yum.repos.d/zextras.repo
                                    '''
                                ],
                            ]
                        ]
                    ])
                }
            }
        }

        stage('Upload artifacts') {
            tools {
                jfrog 'jfrog-cli'
            }
            steps {
                uploadStage(
                    packages: yapHelper.resolvePackageNames()
                )
            }
        }

        stage('Prepare Release') {
            agent {
                node {
                    label 'nodejs-v1'
                }
            }
            when {
                allOf {
                    branch 'devel'
                    expression { params.PREPARE_RELEASE == true }
                    not {
                        expression {
                            return env.GIT_COMMIT_MSG.contains('[skip ci]') ||
                                   env.GIT_COMMIT_MSG.contains('chore(release):')
                        }
                    }
                }
            }
            steps {
                script {
                    container('nodejs-20') {
                        prepareRelease(
                            repoName: 'carbonio-message-broker'
                        )
                    }
                }
            }
        }

        stage('Tag for release') {
            when {
                allOf {
                    branch 'devel'
                    expression {
                        return env.GIT_COMMIT_MSG.contains('chore(release):') &&
                               env.GIT_COMMIT_MSG.contains('[skip ci]')
                    }
                }
            }
            steps {
                script {
                    tagRelease()
                }
            }
        }
    }
}
