function Pars() {
    var Db = require('mysql-activerecord');
    var needle = require('needle');
    var cheerio = require('cheerio');
    var Promise = require("es6-promise").Promise;
    var db = new Db.Adapter({
        server: 'localhost',
        username: '',
        password: '',
        database: '',
        reconnectTimeout: 2000
    });
    var process = [];
    var proxy_url = 'http://api.best-proxies.ru/feeds/proxylist.txt?key=key' +
        '&uptime=2&limit=500&unique=1';
    var startUrl = "www.craigslist.org/about/sites";


    //start scraper
    this.index = function () {
        db.get("city", function (err, res) {
            if (res.length) {
                step2();
            } else {
                step1();
            }
        });
    }


    //scraper entry point
    //receives list of subdomains by city
    function step1() {
        process[1] = true;
        console.log("step1");

        get_page(startUrl).then(function (res) {
            $ = res.cheerio;
            $(".body > h1").each(function (i, e) {
                var country = $(e).text();
                db.insert_ignore("country", {
                    name: country
                }, function (err, res) {
                    if (err) throw err;

                    $(e).next().find("h4").each(function (ii, ee) {
                        db.insert_ignore('state', {
                            country_id: res.insertId,
                            name: $(ee).text()
                        }, function (err, res3) {
                            if (err) throw err;

                            $(ee).next().find("a").each(function (iii, eee) {
                                db.insert_ignore("city", {
                                    state_id: res3.insertId,
                                    name: $(eee).text(),
                                    url: $(eee).attr("href")
                                });
                            });
                        });
                    });
                })
            });

            //make a 15 second delay and start step 2
            setTimeout(function () {
                process[1] = false;
                return step2();
            }, 15000);
        });
    }

    //receives a list of categories for every subdomain (city) 
    function step2() {
        process[2] = true;
        console.log('step2 START');

        getDataForPars('`count` is NULL', 'city', function (res) {
            res.then(function (res) {
                //if we don't need to scrape categories, we end step 2 and start step 3
                if (!res.length) {
                    process[2] = false;
                    return step3();
                }

                var prom = [];
                res.map(function (e) {
                    if (e) {
                        prom.push(_step2(e.cheerio, e.databaseElem));
                    }
                })
                return Promise.all(prom);
            }).then(function (res) {
                db.where("`count` is not null").get("city", function (err, resDB) {
                    if (resDB.length && !process[3]) {
                        //if step 3 is not initiated and there are still unscraped posts we start step 3
                        step3();
                    }
                })
                if (process[2]) {
                    return step2();
                }
            }).catch(function (err) {
                console.log(err);
            })
        })
    }

    //we scrape html and add to database
    function _step2($, e) {
        return new Promise(function (resolve, reject) {
            var data = [];
            $("#center li").each(function (i, ee) {
                var url = $(ee).find('a').attr("href");
                if (getUrl(e.url, url)) {
                    data.push({
                        city_id: e.id,
                        name: $(ee).text(),
                        url: getUrl(e.url, url)
                    })
                }
            });
            if (data.length > 0) {
                db.insert_ignore("cat", data, function (err, res) {
                    if (err) reject(err);

                    db.where({city_id: e.id}).get("cat", function (err, res) {
                        if (err) reject(err);

                        db.where({id: e.id}).update("city", {count: res.length}, function () {
                            resolve(res);
                        })
                    })
                })
            } else {
                resolve(0);
            }
        });
    }

    //receives list of posts on the page
    function step3() {
        process[3] = true;
        var time = new Date().getTime();
        console.log("step3 start");
        getDataForPars('`status` is null OR `status` = "next"', 'cat', function (res) {
            res.then(function (res) {
                var prom = [];
                res.map(function (e) {
                    if (e) {
                        prom.push(_step3(e.cheerio, e.databaseElem));
                    }
                })
                return Promise.all(prom);
            }).then(function (res) {
                db.group_by("`status`").select("count(*) as co,`status`").get("cat", function (err, resDB) {
                    console.log("CITY", resDB)
                    db.get("posts", function (err, resDB) {
                        console.log("POSTS", resDB.length);
                        if (!process[4] && resDB.length > 2000) {
                            step4();
                        }
                    })
                })
                return step3();
            }).catch(function (err) {
                console.log(err);
            })
        });
    }

    //we scrape html and add to database
    function _step3($, e) {
        return new Promise(function (resolve, reject) {
            if ($(".page-container").length) {
                var totalcount = $(".totalcount").eq(0).text().trim();

                if ($("a.button.next").length && $("a.button.next").css("display") == "none" && $(".content .result-row").length == 0) {
                    console.log("-------------------CLOSE");
                    db.where({id: e.id}).update("cat", {status: 'end'}, function (err, _res) {
                        if (err) reject(err);

                        resolve("UPDATE");
                    });
                }

                if ($(".noresults").length > 0) {
                    db.where({id: e.id}).update("cat", {
                        status: "end",
                    }, function (err, res) {
                        if (err) reject(err);

                        resolve("No Res");
                    });
                }

                if ($(".leftside").length || $(".core.personals .mainlink").length) {
                    db.where({id: e.id}).update("cat", {
                        status: "next",
                        url: e.url.split("/")[0] + ($(".leftside").length ? $(".leftside li").eq(0).find("a").attr("href") : $(".core.personals .mainlink").attr("href")),
                        start_url: e.url
                    }, function (err, res) {
                        if (err) reject(err);

                        resolve("No Res");
                    });
                }

                var data = [];

                $(".content .result-row").each(function (i, elem) {
                    var linkPage = $(elem).find(".result-info > a");
                    if (totalcount > i && linkPage.data("id")) {
                        data.push({
                            cat_id: e.id,
                            url: e.url.split("/")[0] + linkPage.attr("href"),
                            post_time: $(elem).find(".result-date").attr("datetime"),
                            title: linkPage.text(),
                            post_id: linkPage.data("id"),
                            price: $(elem).find(".result-price").length ? $(elem).find(".result-price").eq(0).text() : ''
                        })
                    }
                });

                var data_cat = {totalcount: totalcount};
                if (totalcount < 100) {
                    data_cat.status = "end";
                } else if ($("a.button.next").length) {
                    data_cat.status = "next";
                    data_cat.url = e.url.split("/")[0] + $("a.button.next").eq(0).attr("href");
                    data_cat.start_url = e.url;
                } else {
                    data_cat.status = 'end';
                }

                if (e.url == e.url.split("/")[0] + $("a.button.next").eq(0).attr("href")) {
                    data_cat.status = 'end';

                    db.where({id: e.id}).update("cat", {status: "end"}, function (err, _res) {
                        if (err) reject(err);

                        resolve("UPDATE END");
                    });
                }

                if (data.length) {

                    db.insert("posts", data, function (err, _res) {
                        if (err) reject(err);

                        db.where({id: e.id}).update("cat", data_cat, function (err, _res) {
                            if (err) reject(err);

                            resolve("UPDATE");
                        });
                    })
                } else {
                    resolve("no res!");
                }
            } else {
                resolve("no page");
            }
        });
    }

    // closing step. We receive data on every post
    function step4() {
        process[4] = true;
        console.log("step4 start");
        getDataForPars('`body` is null', 'posts', function (res) {
            res.then(function (res) {
                // console.log(res.length);
                var prom = [];
                res.map(function (e) {
                    if (e) {
                        // console.log('push');
                        prom.push(_step4(e.cheerio, e.databaseElem));
                    }
                })
                return Promise.all(prom);
            }).then(function (res) {
                step4();
            }).catch(function (err) {
                console.log(err);
            })
        });
    }

    //we scrape html and add to database
    function _step4($, e) {
        return new Promise(function (resolve, reject) {
            if ($("#postingbody").length) {
                var map = $("#map");
                var data = {
                    body: $("#postingbody").text().trim(),
                    attr: $(".attrgroup").text().trim()
                }
                if (map.length) {
                    data.latitude = map.data("latitude");
                    data.longitude = map.data("longitude");
                    data.accuracy = map.data("accuracy");
                }
                db.where({id: e.id}).update("posts", data, function (err, ress) {
                    if (err) {
                        // console.log(err);
                    }
                    if ($("#thumbs img").length) {
                        var data_pic = [];
                        $("#thumbs a").each(function (i, elem) {
                            data_pic.push({
                                url: $(elem).attr('href'),
                                post_id: e.id
                            });
                        })
                        db.insert("posts_img", data_pic, function (err, _res) {
                            resolve("update with pic");
                        })
                    } else {
                        resolve("updade, no pic");
                    }
                })
            } else {
                resolve("wrong html");
            }
        });
    }


    //receives proxy via API and returns array from proxy
    function getProxy(callback) {
        needle.get(proxy_url, {}, function (err, res) {
            if (err) {
                setTimeout(function () {
                    return getProxy(callback);
                }, 15 * 1000);
                // reject(err)
            } else {
                var proxies = res.body.split("\r\n").sort(function () {
                    return .5 - Math.random();
                });

                if (proxies.length > 0) {
                    callback(proxies)
                } else {
                    setTimeout(function () {
                        return getProxy(callback);
                    }, 15 * 1000);
                }
            }
        });
    }


    //receives proxy and data for scraping
    //return Cheerio array and database array
    function getDataForPars(where, table, callback) {
        getProxy(function (proxy) {
            db.where(where).limit(proxy.length).get(table, function (err, res) {
                if (err) {
                    // console.log(err);
                }
                var data = [];

                var prom = [];
                res.map(function (e, i) {
                    prom.push(get_page(e, proxy[i]));
                });

                callback(Promise.all(prom));
            });
        })
    }

    //receives page via proxy and return Cheerio object
    function get_page(e, proxy) {
        url = typeof(e) == 'string' ? e : e.url;
        return new Promise(function (resolve, reject) {
            var options = {
                follow_max: 5,
                compressed: true,
                open_timeout: 20 * 1000,
                read_timeout: 20 * 1000,
                proxy: proxy
            }

            needle.get(url, options, function (err, res) {
                if (err) {
                    resolve(0);
                } else {
                    resolve({cheerio: cheerio.load(res.body), databaseElem: e});
                }
            });
        });
    }

    //check for domain name in the list
    function getUrl(domain, url) {
        if (!url) {
            return false;
        }
        if (url.indexOf("https://forums") >= 0) {
            return false;
        }
        if (url.indexOf(domain) >= 0) {
            return url;
        }
        return domain + url.substr(1);
    }
}


//start scraper
var p = new Pars();
p.index();